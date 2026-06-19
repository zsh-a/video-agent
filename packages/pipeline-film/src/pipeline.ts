import type {PipelineDefinition} from '@video-agent/runtime'

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

export type FilmPipelineStage = typeof FILM_PIPELINE_STAGES[number]

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

export const FILM_PIPELINE_DEFINITION: PipelineDefinition<'film', FilmPipelineStage> = {
  checkpointArtifactsByStage: FILM_CHECKPOINT_ARTIFACTS_BY_STAGE,
  defaultRerunStage: 'write-script',
  kind: 'film',
  stages: FILM_PIPELINE_STAGES,
}
