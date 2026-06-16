import {
  createFilmAudioMixProject,
  createFilmClipPlanProject,
  createFilmCutProject,
  createFilmFinalRenderProject,
  createFilmIngestProject,
  createFilmOutputNarrationProject,
  createFilmQualityCheckProject,
  createFilmStoryIndexProject,
  createFilmSubtitleProject,
  createFilmUnderstandingProject,
  createFilmVoiceoverProject,
} from '@video-agent/runtime'

export {
  createFilmAudioMixProject,
  createFilmClipPlanProject,
  createFilmCutProject,
  createFilmFinalRenderProject,
  createFilmIngestProject,
  createFilmOutputNarrationProject,
  createFilmQualityCheckProject,
  createFilmStoryIndexProject,
  createFilmSubtitleProject,
  createFilmUnderstandingProject,
  createFilmVoiceoverProject,
} from '@video-agent/runtime'

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
  CreateFilmStoryIndexProjectResult,
  CreateFilmSubtitleProjectResult,
  CreateFilmUnderstandingProjectOptions,
  CreateFilmUnderstandingProjectResult,
  CreateFilmVoiceoverProjectResult,
} from '@video-agent/runtime'

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
  CreateFilmStoryIndexProjectOptions,
  CreateFilmStoryIndexProjectResult,
  CreateFilmSubtitleProjectOptions,
  CreateFilmSubtitleProjectResult,
  CreateFilmUnderstandingProjectOptions,
  CreateFilmUnderstandingProjectResult,
  CreateFilmVoiceoverProjectOptions,
  CreateFilmVoiceoverProjectResult,
} from '@video-agent/runtime'

export interface RunFilmRecapPipelineOptions extends CreateFilmIngestProjectOptions {
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
  status: 'completed'
  storyIndex: CreateFilmStoryIndexProjectResult
  subtitle: CreateFilmSubtitleProjectResult
  understanding: CreateFilmUnderstandingProjectResult
  voiceover: CreateFilmVoiceoverProjectResult
}

export async function runFilmRecapPipeline(options: RunFilmRecapPipelineOptions): Promise<RunFilmRecapPipelineResult> {
  const ingest = await createFilmIngestProject(options)
  const common = {
    projectId: ingest.projectId,
    workspaceDir: options.workspaceDir,
  }
  const understanding = await createFilmUnderstandingProject({
    ...common,
    maxScenes: options.maxScenes,
  })
  const storyIndex = await createFilmStoryIndexProject(common)
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
    status: 'completed',
    storyIndex,
    subtitle,
    understanding,
    voiceover,
  }
}
