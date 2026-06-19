import type {PipelineDefinition} from '@video-agent/runtime'

export const DECK_PIPELINE_STAGES = ['ingest', 'transcribe', 'understand', 'plan', 'script', 'align', 'synthesize-voice', 'update-timing', 'render-final', 'quality'] as const

export type DeckPipelineStage = typeof DECK_PIPELINE_STAGES[number]

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

export const DECK_PIPELINE_DEFINITION: PipelineDefinition<'deck', DeckPipelineStage> = {
  checkpointArtifactsByStage: DECK_CHECKPOINT_ARTIFACTS_BY_STAGE,
  defaultRerunStage: 'script',
  kind: 'deck',
  stages: DECK_PIPELINE_STAGES,
}
