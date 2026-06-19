import type {
  CreateFilmClipPlanProjectOptions,
  CreateFilmClipPlanProjectResult,
  CreateFilmIngestProjectOptions,
  CreateFilmIngestProjectResult,
  CreateFilmRecapScriptProjectResult,
  CreateFilmStoryIndexProjectOptions,
  CreateFilmStoryIndexProjectResult,
  CreateFilmUnderstandingProjectOptions,
  CreateFilmUnderstandingProjectResult,
} from './project/index.js'
import type {
  CreateFilmAudioMixProjectResult,
  CreateFilmCutProjectResult,
  CreateFilmFinalRenderProjectResult,
  CreateFilmOutputNarrationProjectResult,
  CreateFilmQualityCheckProjectResult,
  CreateFilmSubtitleProjectResult,
  CreateFilmVoiceoverProjectResult,
} from './output/index.js'

import {
  createFilmClipPlanProject,
  createFilmIngestProject,
  createFilmRecapScriptProject,
  createFilmStoryIndexProject,
  createFilmUnderstandingProject,
} from './project/index.js'
import {
  createFilmAudioMixProject,
  createFilmCutProject,
  createFilmFinalRenderProject,
  createFilmOutputNarrationProject,
  createFilmQualityCheckProject,
  createFilmSubtitleProject,
  createFilmVoiceoverProject,
} from './output/index.js'

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
