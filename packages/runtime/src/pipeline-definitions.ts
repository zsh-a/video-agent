import type {JobState} from '@video-agent/db'

export const INITIAL_PIPELINE_STAGES = ['ingest', 'understand', 'plan', 'script', 'voiceover', 'quality'] as const
export const FILM_PIPELINE_STAGES = [
  'ingest',
  'understand-source',
  'build-story-index',
  'plan-clips',
  'render-cut',
  'narrate-output',
  'synthesize-voice',
  'mix-audio',
  'subtitle',
  'render-final',
  'quality-check',
] as const

export type InitialPipelineStage = typeof INITIAL_PIPELINE_STAGES[number]
export type FilmPipelineStage = typeof FILM_PIPELINE_STAGES[number]
export type PipelineKind = 'film' | 'initial'
export type PipelineStage = FilmPipelineStage | InitialPipelineStage

export interface PipelineDefinition<K extends PipelineKind = PipelineKind, S extends string = PipelineStage> {
  checkpointArtifactsByStage: Partial<Record<PipelineStage, readonly string[]>>
  defaultRerunStage: S
  kind: K
  stages: readonly S[]
}

export const INITIAL_CHECKPOINT_ARTIFACTS_BY_STAGE: Record<InitialPipelineStage, readonly string[]> = {
  ingest: [],
  plan: ['ingest-report.json', 'media-info.json', 'chunk-plan.json', 'frames.json', 'scene-analysis.json', 'scene-batches.json', 'transcript.json', 'chunk-summaries.json', 'chapters.json', 'global-outline.json', 'selected-moments.json'],
  quality: ['ingest-report.json', 'media-info.json', 'chunk-plan.json', 'frames.json', 'scene-analysis.json', 'scene-batches.json', 'transcript.json', 'chunk-summaries.json', 'chapters.json', 'global-outline.json', 'selected-moments.json', 'storyboard.json', 'clip-plan.json', 'timeline.json', 'narration.json', 'tts-segments.json'],
  script: ['ingest-report.json', 'media-info.json', 'chunk-plan.json', 'frames.json', 'scene-analysis.json', 'scene-batches.json', 'transcript.json', 'chunk-summaries.json', 'chapters.json', 'global-outline.json', 'selected-moments.json', 'storyboard.json', 'clip-plan.json', 'timeline.json'],
  understand: ['ingest-report.json', 'media-info.json', 'chunk-plan.json', 'frames.json'],
  voiceover: ['ingest-report.json', 'media-info.json', 'chunk-plan.json', 'frames.json', 'scene-analysis.json', 'scene-batches.json', 'transcript.json', 'chunk-summaries.json', 'chapters.json', 'global-outline.json', 'selected-moments.json', 'storyboard.json', 'clip-plan.json', 'timeline.json', 'narration.json'],
}

export const FILM_CHECKPOINT_ARTIFACTS_BY_STAGE: Record<FilmPipelineStage, readonly string[]> = {
  ingest: [],
  'understand-source': ['source-manifest.json', 'media-info.json'],
  'build-story-index': ['source-manifest.json', 'media-info.json', 'scenes.json', 'frames.json', 'asr-result.json', 'silence-periods.json', 'vlm-analysis.json', 'timeline-fusion.json'],
  'plan-clips': ['source-manifest.json', 'story-index.json', 'narrative-beats.json', 'character-index.json'],
  'render-cut': ['source-manifest.json', 'clip-plan.json'],
  'narrate-output': ['story-index.json', 'clip-plan-validated.json', 'output-timeline-map.json'],
  'synthesize-voice': ['narration.json', 'output-narration.json'],
  'mix-audio': ['source-manifest.json', 'output-timeline-map.json', 'narration.json', 'tts-segments.json'],
  subtitle: ['narration.json'],
  'render-final': ['audio-mix.json', 'subtitles.json', 'output-timeline-map.json'],
  'quality-check': ['render-output.json', 'narration.json', 'tts-segments.json'],
}

export const INITIAL_PIPELINE_DEFINITION: PipelineDefinition<'initial', InitialPipelineStage> = {
  checkpointArtifactsByStage: INITIAL_CHECKPOINT_ARTIFACTS_BY_STAGE,
  defaultRerunStage: 'plan',
  kind: 'initial',
  stages: INITIAL_PIPELINE_STAGES,
}

export const FILM_PIPELINE_DEFINITION: PipelineDefinition<'film', FilmPipelineStage> = {
  checkpointArtifactsByStage: FILM_CHECKPOINT_ARTIFACTS_BY_STAGE,
  defaultRerunStage: 'plan-clips',
  kind: 'film',
  stages: FILM_PIPELINE_STAGES,
}

export const PIPELINE_DEFINITIONS = {
  film: FILM_PIPELINE_DEFINITION,
  initial: INITIAL_PIPELINE_DEFINITION,
} as const

export const ALL_PIPELINE_STAGES = [...INITIAL_PIPELINE_STAGES, ...FILM_PIPELINE_STAGES.filter((stage) => !INITIAL_PIPELINE_STAGES.includes(stage as InitialPipelineStage))] as const

export function detectPipelineKind(job: Pick<JobState, 'stages'> & {pipeline?: string}): PipelineKind {
  if (job.pipeline === 'film' || job.pipeline === 'initial') {
    return job.pipeline
  }

  const stageNames = new Set(job.stages.map((stage) => stage.name))

  return FILM_PIPELINE_STAGES.some((stage) => stage !== 'ingest' && stageNames.has(stage)) ? 'film' : 'initial'
}

export function getPipelineDefinition(kind: PipelineKind): PipelineDefinition {
  return PIPELINE_DEFINITIONS[kind]
}

export function isPipelineStage(definition: PipelineDefinition, value: string | undefined): value is PipelineStage {
  return value !== undefined && definition.stages.includes(value as never)
}

export function assertPipelineStage(definition: PipelineDefinition, value: string): PipelineStage {
  if (isPipelineStage(definition, value)) {
    return value
  }

  throw new Error(`Unknown ${definition.kind} pipeline stage: ${value}`)
}
