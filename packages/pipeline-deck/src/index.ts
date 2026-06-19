export {
  DECK_CHECKPOINT_ARTIFACTS_BY_STAGE,
  DECK_PIPELINE_DEFINITION,
  DECK_PIPELINE_STAGES,
} from './pipeline.js'
export type {DeckPipelineStage} from './pipeline.js'

export {
  createDeckAudioAnchoredProject,
  createDeckExplainerProject,
  createDeckSummarizeProject,
  createDeckVoiceoverProject,
} from './deck-project.js'

export type {
  CreateDeckAudioAnchoredProjectOptions,
  CreateDeckAudioAnchoredProjectResult,
  CreateDeckAudioSummaryProjectResult,
  CreateDeckExplainerProjectOptions,
  CreateDeckExplainerProjectResult,
  CreateDeckSummarizeProjectOptions,
  CreateDeckSummarizeProjectResult,
  CreateDeckVoiceoverProjectOptions,
  CreateDeckVoiceoverProjectResult,
} from './deck-project.js'

export {
  createDeckFrameShardBatchProject,
  createDeckFrameShardPlanProject,
} from './deck-frame-shards.js'
export type {
  CreateDeckFrameShardBatchProjectOptions,
  CreateDeckFrameShardBatchProjectResult,
  CreateDeckFrameShardPlanProjectOptions,
  CreateDeckFrameShardPlanProjectResult,
  DeckFrameShardBatchShard,
  DeckFrameShardPlanShard,
} from './deck-frame-shards.js'

export {createDeckFinalRenderProject} from './deck-final-render.js'
export type {CreateDeckFinalRenderProjectOptions, CreateDeckFinalRenderProjectResult} from './deck-final-render.js'

export {
  createDeckRemotionRenderProject,
  createDeckRendererBackendProject,
} from './deck-renderer-backend.js'
export type {
  CreateDeckRemotionRenderProjectOptions,
  CreateDeckRemotionRenderProjectResult,
  CreateDeckRendererBackendProjectOptions,
  CreateDeckRendererBackendProjectResult,
  DeckRendererBackend,
} from './deck-renderer-backend.js'

export {runDeckExplainerPipeline} from './deck-runner.js'
export type {DeckExplainerPipelineMode, RunDeckExplainerPipelineOptions, RunDeckExplainerPipelineResult} from './deck-runner.js'
