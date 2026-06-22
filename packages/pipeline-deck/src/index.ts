export {DECK_FINAL_RENDERERS, DEFAULT_DECK_FINAL_RENDERER} from './render/renderers.js'
export type {DeckFinalRenderer} from './render/renderers.js'

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
} from './project/index.js'

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
} from './project/index.js'

export {
  createDeckFrameShardBatchProject,
  createDeckFrameShardPlanProject,
} from './render/frames/shards/index.js'
export type {
  CreateDeckFrameShardBatchProjectOptions,
  CreateDeckFrameShardBatchProjectResult,
  CreateDeckFrameShardPlanProjectOptions,
  CreateDeckFrameShardPlanProjectResult,
  DeckFrameShardBatchShard,
  DeckFrameShardPlanShard,
} from './render/frames/shards/index.js'

export {createDeckFinalRenderProject} from './render/final/index.js'
export type {CreateDeckFinalRenderProjectOptions, CreateDeckFinalRenderProjectResult} from './render/final/index.js'

export {
  createDeckRemotionRenderProject,
  createDeckRendererBackendProject,
} from './render/backend.js'
export type {
  CreateDeckRemotionRenderProjectOptions,
  CreateDeckRemotionRenderProjectResult,
  CreateDeckRendererBackendProjectOptions,
  CreateDeckRendererBackendProjectResult,
} from './render/backend.js'

export {DECK_EXPLAINER_PIPELINE_MODES, runDeckExplainerPipeline} from './runner.js'
export type {DeckExplainerPipelineMode, RunDeckExplainerPipelineOptions, RunDeckExplainerPipelineResult} from './runner.js'
