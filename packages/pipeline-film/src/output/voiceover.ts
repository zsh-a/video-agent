import type {OutputNarration} from '@video-agent/ir'
import type {TTSInputSegment} from '@video-agent/providers'

import {OutputNarrationSchema} from '@video-agent/ir'
import {TtsSegmentsSchema} from '@video-agent/providers'
import {join} from 'node:path'

import {OUTPUT_NARRATION_ARTIFACT_NAME, TTS_SEGMENTS_ARTIFACT_NAME, createRuntimeProviders, instrumentProviders, readConfig, refreshArtifactManifest, DEFAULT_WORKSPACE_DIR} from '@video-agent/runtime'
import type {CreateFilmVoiceoverProjectOptions, CreateFilmVoiceoverProjectResult} from './types.js'
import {FILM_STAGE_IDS} from '../pipeline.js'
import {alignFilmTtsSegmentsToOutputNarration} from '../render/index.js'
import {createFilmLLMTrace, createFilmProviderCallRecorder, openFilmStageWorkspace} from '../shared/stage-runtime.js'
import {roundSeconds} from '../shared/utils.js'

export async function createFilmVoiceoverProject(options: CreateFilmVoiceoverProjectOptions): Promise<CreateFilmVoiceoverProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? DEFAULT_WORKSPACE_DIR
  const {agent, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: FILM_STAGE_IDS.synthesizeVoice,
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
    const outputNarration = OutputNarrationSchema.parse(await workspace.store.readJson(OUTPUT_NARRATION_ARTIFACT_NAME))
    const ttsSegments = await alignFilmTtsSegmentsToOutputNarration(workspace.projectDir, outputNarration, TtsSegmentsSchema.parse(await providers.tts.synthesize(createFilmTtsInputSegments(outputNarration), {
      outputDir: join(workspace.audioDir, 'tts'),
      pathPrefix: 'audio/tts',
    })))
    const artifacts = {
      ttsSegments: await workspace.store.writeJson(TTS_SEGMENTS_ARTIFACT_NAME, ttsSegments),
    }

    await agent.completeStage(FILM_STAGE_IDS.synthesizeVoice)
    await agent.completeRun('Film stage synthesize-voice complete')
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
    await agent.failStage(FILM_STAGE_IDS.synthesizeVoice, error)
    await agent.failRun(error)
    throw error
  }
}

function createFilmTtsInputSegments(outputNarration: OutputNarration): TTSInputSegment[] {
  return outputNarration.segments.map((segment) => {
    const duration = roundSeconds(segment.end - segment.start)

    if (duration <= 0) {
      throw new Error(`Film output narration segment "${segment.id}" must have a positive duration before TTS synthesis.`)
    }

    return {
      duration,
      id: segment.id,
      text: segment.text,
    }
  })
}
