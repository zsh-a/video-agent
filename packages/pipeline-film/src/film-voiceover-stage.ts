import {NarrationSchema} from '@video-agent/ir'
import {TtsSegmentsSchema} from '@video-agent/providers'
import {join} from 'node:path'

import {createRuntimeProviders, instrumentProviders, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import type {CreateFilmVoiceoverProjectOptions, CreateFilmVoiceoverProjectResult} from './film-output-stage-types.js'
import {alignFilmTtsSegmentsToNarration} from './film-rendering.js'
import {completeFilmStage, createFilmLLMTrace, createFilmProviderCallRecorder, failFilmStage, openFilmStageWorkspace} from './film-stage-runtime.js'

export async function createFilmVoiceoverProject(options: CreateFilmVoiceoverProjectOptions): Promise<CreateFilmVoiceoverProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const {jobStore, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: 'synthesize-voice',
    workspaceDir,
  })

  try {
    const config = await readConfig(workspaceDir)
    const llmTrace = createFilmLLMTrace(workspace, options.trace)
    const providers = instrumentProviders(
      await createRuntimeProviders(config, workspaceDir, {
        llmClient: options.llmClient,
        llmTrace: llmTrace.recorder,
      }),
      config.providers,
      createFilmProviderCallRecorder(workspace),
    )
    const narration = NarrationSchema.parse(await workspace.store.readJson('narration.json'))
    const ttsSegments = await alignFilmTtsSegmentsToNarration(workspace.projectDir, narration, TtsSegmentsSchema.parse(await providers.tts.synthesize(narration.segments, {
      outputDir: join(workspace.audioDir, 'tts'),
      pathPrefix: 'audio/tts',
    })))
    const artifacts = {
      ttsSegments: await workspace.store.writeJson('tts-segments.json', ttsSegments),
    }

    await completeFilmStage(jobStore, workspace, 'synthesize-voice')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId,
      segments: ttsSegments.length,
      status: 'voiced',
      ttsSegments,
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'synthesize-voice', error)
    throw error
  }
}
