import type {PipelineDefinition} from '@video-agent/runtime'

export const DECK_PIPELINE_STAGES = ['ingest', 'source-map', 'transcribe', 'understand', 'brief', 'outline', 'plan-slides', 'script', 'timing-preflight', 'align', 'synthesize-voice', 'timing-repair', 'visual-preflight', 'render-final', 'review'] as const

export type DeckPipelineStage = typeof DECK_PIPELINE_STAGES[number]

export const DECK_CHECKPOINT_ARTIFACTS_BY_STAGE: Record<DeckPipelineStage, readonly string[]> = {
  ingest: [],
  'source-map': ['source-map.json'],
  transcribe: ['media-info.json'],
  understand: ['source-map.json', 'content-analysis.json', 'document.json', 'media-info.json'],
  brief: ['content-analysis.json', 'deck-brief.json'],
  outline: ['deck-brief.json', 'slide-outline.json', 'deck-coverage-report.json'],
  'plan-slides': ['deck.json', 'timed-deck.json'],
  script: ['deck.json', 'speaker-script.json'],
  'timing-preflight': ['script-timing-report.json', 'timed-deck.json'],
  align: ['deck.json', 'timed-deck.json', 'speaker-script.json'],
  'synthesize-voice': ['narration.json', 'timed-deck.json'],
  'timing-repair': ['deck-voiceover.json', 'deck-timing-report.json', 'tts-segments.json'],
  'visual-preflight': ['deck-quality-report.json'],
  'render-final': ['timed-deck.json', 'deck-voiceover.json'],
  review: ['render-output.json', 'review-report.json'],
}

export const DECK_PIPELINE_DEFINITION: PipelineDefinition<'deck', DeckPipelineStage> = {
  checkpointArtifactsByStage: DECK_CHECKPOINT_ARTIFACTS_BY_STAGE,
  defaultRerunStage: 'outline',
  kind: 'deck',
  stages: DECK_PIPELINE_STAGES,
}
