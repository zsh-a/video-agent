import {
  createFilmAudioMixProject,
  createFilmClipPlanProject,
  createFilmCutProject,
  createFilmFinalRenderProject,
  createFilmIngestProject,
  createFilmOutputNarrationProject,
  createFilmQualityCheckProject,
  createFilmRecapScriptProject,
  createFilmStoryIndexProject,
  createFilmSubtitleProject,
  createFilmUnderstandingProject,
  createFilmVoiceoverProject,
} from './film-project.js'

export {
  FILM_CHECKPOINT_ARTIFACTS_BY_STAGE,
  FILM_PIPELINE_DEFINITION,
  FILM_PIPELINE_STAGES,
} from './pipeline.js'
export type {FilmPipelineStage} from './pipeline.js'

export {
  createFilmAudioMixProject,
  createFilmClipPlanProject,
  createFilmCutProject,
  createFilmFinalRenderProject,
  createFilmIngestProject,
  createFilmOutputNarrationProject,
  createFilmQualityCheckProject,
  createFilmRecapScriptProject,
  createFilmStoryIndexProject,
  createFilmSubtitleProject,
  createFilmUnderstandingProject,
  createFilmVoiceoverProject,
  runFilmRecapProject,
} from './film-project.js'
export {recoverWorkspaceJobs} from './worker.js'
export {rerunProject} from './rerun.js'

import type {
  CreateFilmAudioMixProjectResult,
  CreateFilmClipPlanProjectOptions,
  CreateFilmClipPlanProjectResult,
  CreateFilmCutProjectResult,
  CreateFilmFinalRenderProjectResult,
  CreateFilmIngestProjectOptions,
  CreateFilmIngestProjectResult,
  CreateFilmOutputNarrationProjectResult,
  CreateFilmQualityCheckProjectResult,
  CreateFilmRecapScriptProjectResult,
  CreateFilmStoryIndexProjectOptions,
  CreateFilmStoryIndexProjectResult,
  CreateFilmSubtitleProjectResult,
  CreateFilmUnderstandingProjectOptions,
  CreateFilmUnderstandingProjectResult,
  CreateFilmVoiceoverProjectResult,
} from './film-project.js'

export type {
  CreateFilmAudioMixProjectOptions,
  CreateFilmAudioMixProjectResult,
  CreateFilmClipPlanProjectOptions,
  CreateFilmClipPlanProjectResult,
  CreateFilmCutProjectOptions,
  CreateFilmCutProjectResult,
  CreateFilmFinalRenderProjectOptions,
  CreateFilmFinalRenderProjectResult,
  CreateFilmIngestProjectOptions,
  CreateFilmIngestProjectResult,
  CreateFilmOutputNarrationProjectOptions,
  CreateFilmOutputNarrationProjectResult,
  CreateFilmQualityCheckProjectOptions,
  CreateFilmQualityCheckProjectResult,
  CreateFilmRecapScriptProjectOptions,
  CreateFilmRecapScriptProjectResult,
  CreateFilmStoryIndexProjectOptions,
  CreateFilmStoryIndexProjectResult,
  CreateFilmSubtitleProjectOptions,
  CreateFilmSubtitleProjectResult,
  CreateFilmUnderstandingProjectOptions,
  CreateFilmUnderstandingProjectResult,
  CreateFilmVoiceoverProjectOptions,
  CreateFilmVoiceoverProjectResult,
  RunFilmRecapProjectOptions,
  RunFilmRecapProjectResult,
} from './film-project.js'
export type {RecoverableJobStatus, RecoverWorkspaceJobResult, RecoverWorkspaceJobsOptions, RecoverWorkspaceJobsReport, RecoveryOrderBy} from './worker.js'
export type {RerunProjectOptions, RerunProjectResult} from './rerun.js'

export interface RunFilmRecapPipelineOptions extends CreateFilmIngestProjectOptions {
  llmClient?: CreateFilmStoryIndexProjectOptions['llmClient']
  maxScenes?: CreateFilmUnderstandingProjectOptions['maxScenes']
  targetDurationSeconds?: CreateFilmClipPlanProjectOptions['targetDurationSeconds']
}

export interface RunFilmRecapPipelineResult {
  audioMix: CreateFilmAudioMixProjectResult
  clipPlan: CreateFilmClipPlanProjectResult
  cut: CreateFilmCutProjectResult
  finalRender: CreateFilmFinalRenderProjectResult
  ingest: CreateFilmIngestProjectResult
  narration: CreateFilmOutputNarrationProjectResult
  projectDir: string
  projectId: string
  quality: CreateFilmQualityCheckProjectResult
  script: CreateFilmRecapScriptProjectResult
  status: 'completed'
  storyIndex: CreateFilmStoryIndexProjectResult
  subtitle: CreateFilmSubtitleProjectResult
  understanding: CreateFilmUnderstandingProjectResult
  voiceover: CreateFilmVoiceoverProjectResult
}

export async function runFilmRecapPipeline(options: RunFilmRecapPipelineOptions): Promise<RunFilmRecapPipelineResult> {
  const ingest = await createFilmIngestProject(options)
  const common = {
    llmClient: options.llmClient,
    projectId: ingest.projectId,
    trace: options.trace,
    workspaceDir: options.workspaceDir,
  }
  const understanding = await createFilmUnderstandingProject({
    ...common,
    maxScenes: options.maxScenes,
  })
  const storyIndex = await createFilmStoryIndexProject(common)
  const script = await createFilmRecapScriptProject({
    ...common,
    targetDurationSeconds: options.targetDurationSeconds,
  })
  const clipPlan = await createFilmClipPlanProject({
    ...common,
    targetDurationSeconds: options.targetDurationSeconds,
  })
  const cut = await createFilmCutProject(common)
  const narration = await createFilmOutputNarrationProject(common)
  const voiceover = await createFilmVoiceoverProject(common)
  const audioMix = await createFilmAudioMixProject(common)
  const subtitle = await createFilmSubtitleProject(common)
  const finalRender = await createFilmFinalRenderProject(common)
  const quality = await createFilmQualityCheckProject(common)

  return {
    audioMix,
    clipPlan,
    cut,
    finalRender,
    ingest,
    narration,
    projectDir: ingest.projectDir,
    projectId: ingest.projectId,
    quality,
    script,
    status: 'completed',
    storyIndex,
    subtitle,
    understanding,
    voiceover,
  }
}
