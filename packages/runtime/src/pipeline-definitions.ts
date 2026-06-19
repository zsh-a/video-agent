import type {JobState} from '@video-agent/db'

export const DECK_PIPELINE_STAGES = ['ingest', 'transcribe', 'understand', 'plan', 'script', 'align', 'synthesize-voice', 'update-timing', 'render-final', 'quality'] as const
export const FILM_PIPELINE_STAGES = [
  'ingest',
  'understand-source',
  'build-story-index',
  'write-script',
  'plan-clips',
  'render-cut',
  'narrate-output',
  'synthesize-voice',
  'mix-audio',
  'subtitle',
  'render-final',
  'quality-check',
] as const

export type DeckPipelineStage = typeof DECK_PIPELINE_STAGES[number]
export type FilmPipelineStage = typeof FILM_PIPELINE_STAGES[number]
export type PipelineKind = 'deck' | 'film'
export type PipelineStage = DeckPipelineStage | FilmPipelineStage

export interface PipelineDefinition<K extends PipelineKind = PipelineKind, S extends string = PipelineStage> {
  checkpointArtifactsByStage: Partial<Record<PipelineStage, readonly string[]>>
  defaultRerunStage: S
  kind: K
  stages: readonly S[]
}

export const DECK_CHECKPOINT_ARTIFACTS_BY_STAGE: Record<DeckPipelineStage, readonly string[]> = {
  ingest: [],
  transcribe: ['media-info.json'],
  understand: ['document.json', 'media-info.json'],
  plan: ['document.json', 'content-blocks.json', 'outline.json'],
  script: ['deck.json', 'timed-deck.json', 'speaker-script.json'],
  align: ['deck.json', 'timed-deck.json', 'speaker-script.json'],
  'synthesize-voice': ['narration.json', 'timed-deck.json'],
  'update-timing': ['deck-voiceover.json', 'tts-segments.json'],
  'render-final': ['timed-deck.json', 'deck-voiceover.json'],
  quality: ['render-output.json', 'deck-quality-report.json'],
}

export const FILM_CHECKPOINT_ARTIFACTS_BY_STAGE: Record<FilmPipelineStage, readonly string[]> = {
  ingest: [],
  'understand-source': ['source-manifest.json', 'media-info.json'],
  'build-story-index': ['source-manifest.json', 'media-info.json', 'scenes.json', 'frames.json', 'asr-result.json', 'silence-periods.json', 'vlm-analysis.json', 'timeline-fusion.json'],
  'write-script': ['source-manifest.json', 'story-index.json', 'asr-result.json', 'vlm-analysis.json'],
  'plan-clips': ['source-manifest.json', 'story-index.json', 'asr-result.json', 'recap-script.json'],
  'render-cut': ['source-manifest.json', 'clip-plan.json'],
  'narrate-output': ['story-index.json', 'asr-result.json', 'clip-plan-validated.json', 'output-timeline-map.json', 'recap-script.json'],
  'synthesize-voice': ['narration.json', 'output-narration.json'],
  'mix-audio': ['source-manifest.json', 'output-timeline-map.json', 'narration.json', 'tts-segments.json'],
  subtitle: ['narration.json'],
  'render-final': ['audio-mix.json', 'subtitles.json', 'output-timeline-map.json'],
  'quality-check': ['render-output.json', 'narration.json', 'tts-segments.json', 'output-timeline-map.json'],
}

export const DECK_PIPELINE_DEFINITION: PipelineDefinition<'deck', DeckPipelineStage> = {
  checkpointArtifactsByStage: DECK_CHECKPOINT_ARTIFACTS_BY_STAGE,
  defaultRerunStage: 'script',
  kind: 'deck',
  stages: DECK_PIPELINE_STAGES,
}

export const FILM_PIPELINE_DEFINITION: PipelineDefinition<'film', FilmPipelineStage> = {
  checkpointArtifactsByStage: FILM_CHECKPOINT_ARTIFACTS_BY_STAGE,
  defaultRerunStage: 'write-script',
  kind: 'film',
  stages: FILM_PIPELINE_STAGES,
}

export const PIPELINE_DEFINITIONS = {
  deck: DECK_PIPELINE_DEFINITION,
  film: FILM_PIPELINE_DEFINITION,
} as const

export const ALL_PIPELINE_STAGES = [...DECK_PIPELINE_STAGES, ...FILM_PIPELINE_STAGES.filter((stage) => !DECK_PIPELINE_STAGES.includes(stage as DeckPipelineStage))] as const

export function detectPipelineKind(job: Pick<JobState, 'stages'> & {pipeline?: string}): PipelineKind {
  if (job.pipeline === 'deck' || job.pipeline === 'film') {
    return job.pipeline
  }

  const stageNames = new Set(job.stages.map((stage) => stage.name))

  if (FILM_PIPELINE_STAGES.some((stage) => stage !== 'ingest' && stageNames.has(stage))) {
    return 'film'
  }

  if (DECK_PIPELINE_STAGES.some((stage) => stage !== 'ingest' && stageNames.has(stage))) {
    return 'deck'
  }

  throw new Error('Cannot determine project pipeline kind from job-state.json.')
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
