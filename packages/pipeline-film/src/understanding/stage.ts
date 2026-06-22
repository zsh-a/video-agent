import {ASRResultSchema, FilmScenesSchema, LongVideoAnalysisFramesSchema, SilencePeriodsSchema, SourceManifestSchema, TimelineFusionSchema, VLMAnalysisSchema} from '@video-agent/ir'
import {detectVideoSceneChanges} from '@video-agent/media'

import {ASR_RESULT_ARTIFACT_NAME, FRAMES_ARTIFACT_NAME, SCENES_ARTIFACT_NAME, SILENCE_PERIODS_ARTIFACT_NAME, SOURCE_MANIFEST_ARTIFACT_NAME, TIMELINE_FUSION_ARTIFACT_NAME, VLM_ANALYSIS_ARTIFACT_NAME, createRuntimeProviders, instrumentProviders, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import {FILM_STAGE_IDS} from '../pipeline.js'
import type {CreateFilmUnderstandingProjectOptions, CreateFilmUnderstandingProjectResult} from '../project/types.js'
import {createFilmLLMTrace, createFilmProviderCallRecorder, openFilmStageWorkspace} from '../shared/stage-runtime.js'
import {DEFAULT_FILM_MAX_SCENES, createFilmAsrResult, createFilmFrameManifest, createFilmScenesFromEvidence, createFilmSilencePeriods, createFilmVlmAnalysis, createTimelineFusion} from './evidence.js'

export async function createFilmUnderstandingProject(options: CreateFilmUnderstandingProjectOptions): Promise<CreateFilmUnderstandingProjectResult> {
  const projectId = options.projectId
  const {agent, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: FILM_STAGE_IDS.understandSource,
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
    const sourceManifest = SourceManifestSchema.parse(await workspace.store.readJson(SOURCE_MANIFEST_ARTIFACT_NAME))
    const asrResult = ASRResultSchema.parse(await createFilmAsrResult(workspace.audioDir, sourceManifest, providers))
    const silencePeriods = SilencePeriodsSchema.parse(createFilmSilencePeriods(sourceManifest, asrResult))
    const visualSceneChanges = await detectVideoSceneChanges(sourceManifest.sourcePath)
    const scenes = FilmScenesSchema.parse(createFilmScenesFromEvidence(sourceManifest, asrResult, silencePeriods, visualSceneChanges.timestamps, options.maxScenes ?? DEFAULT_FILM_MAX_SCENES))
    const frames = LongVideoAnalysisFramesSchema.parse(await createFilmFrameManifest(workspace.framesDir, sourceManifest, scenes))
    const vlmAnalysis = VLMAnalysisSchema.parse(await createFilmVlmAnalysis(sourceManifest, scenes, frames, providers))
    const timelineFusion = TimelineFusionSchema.parse(createTimelineFusion(sourceManifest, scenes, asrResult, silencePeriods, vlmAnalysis))
    const artifacts = {
      scenes: await workspace.store.writeJson(SCENES_ARTIFACT_NAME, scenes),
      frames: await workspace.store.writeJson(FRAMES_ARTIFACT_NAME, frames),
      asrResult: await workspace.store.writeJson(ASR_RESULT_ARTIFACT_NAME, asrResult),
      silencePeriods: await workspace.store.writeJson(SILENCE_PERIODS_ARTIFACT_NAME, silencePeriods),
      vlmAnalysis: await workspace.store.writeJson(VLM_ANALYSIS_ARTIFACT_NAME, vlmAnalysis),
      timelineFusion: await workspace.store.writeJson(TIMELINE_FUSION_ARTIFACT_NAME, timelineFusion),
    }

    await agent.completeStage(FILM_STAGE_IDS.understandSource)
    await agent.completeRun('Film stage understand-source complete')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId,
      scenes: scenes.scenes.length,
      status: 'understood',
    }
  } catch (error) {
    await agent.failStage(FILM_STAGE_IDS.understandSource, error)
    await agent.failRun(error)
    throw error
  }
}
