import {ASRResultSchema, FilmScenesSchema, LongVideoAnalysisFramesSchema, SilencePeriodsSchema, SourceManifestSchema, TimelineFusionSchema, VLMAnalysisSchema} from '@video-agent/ir'
import {detectVideoSceneChanges} from '@video-agent/media'

import {createRuntimeProviders, instrumentProviders, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import type {CreateFilmUnderstandingProjectOptions, CreateFilmUnderstandingProjectResult} from './film-project-types.js'
import {completeFilmStage, createFilmLLMTrace, createFilmProviderCallRecorder, failFilmStage, openFilmStageWorkspace} from './film-stage-runtime.js'
import {createFilmAsrResult, createFilmFrameManifest, createFilmScenesFromEvidence, createFilmSilencePeriods, createFilmVlmAnalysis, createTimelineFusion} from './film-understanding.js'

export async function createFilmUnderstandingProject(options: CreateFilmUnderstandingProjectOptions): Promise<CreateFilmUnderstandingProjectResult> {
  const projectId = options.projectId
  const {jobStore, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: 'understand-source',
    workspaceDir: options.workspaceDir,
  })

  try {
    const config = await readConfig(workspace.workspaceDir)
    const llmTrace = createFilmLLMTrace(workspace, options.trace)
    const providers = instrumentProviders(
      await createRuntimeProviders(config, workspace.workspaceDir, {
        llmClient: options.llmClient,
        llmTrace: llmTrace.recorder,
      }),
      config.providers,
      createFilmProviderCallRecorder(workspace),
    )
    const sourceManifest = SourceManifestSchema.parse(await workspace.store.readJson('source-manifest.json'))
    const asrResult = ASRResultSchema.parse(await createFilmAsrResult(workspace.audioDir, sourceManifest, providers))
    const silencePeriods = SilencePeriodsSchema.parse(createFilmSilencePeriods(sourceManifest, asrResult))
    const visualSceneChanges = await detectVideoSceneChanges(sourceManifest.sourcePath)
    const scenes = FilmScenesSchema.parse(createFilmScenesFromEvidence(sourceManifest, asrResult, silencePeriods, visualSceneChanges.timestamps, options.maxScenes ?? 12))
    const frames = LongVideoAnalysisFramesSchema.parse(await createFilmFrameManifest(workspace.framesDir, sourceManifest, scenes))
    const vlmAnalysis = VLMAnalysisSchema.parse(await createFilmVlmAnalysis(sourceManifest, scenes, frames, providers))
    const timelineFusion = TimelineFusionSchema.parse(createTimelineFusion(sourceManifest, scenes, asrResult, silencePeriods, vlmAnalysis))
    const artifacts = {
      scenes: await workspace.store.writeJson('scenes.json', scenes),
      frames: await workspace.store.writeJson('frames.json', frames),
      asrResult: await workspace.store.writeJson('asr-result.json', asrResult),
      silencePeriods: await workspace.store.writeJson('silence-periods.json', silencePeriods),
      vlmAnalysis: await workspace.store.writeJson('vlm-analysis.json', vlmAnalysis),
      timelineFusion: await workspace.store.writeJson('timeline-fusion.json', timelineFusion),
    }

    await completeFilmStage(jobStore, workspace, 'understand-source')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId,
      scenes: scenes.scenes.length,
      status: 'understood',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'understand-source', error)
    throw error
  }
}
