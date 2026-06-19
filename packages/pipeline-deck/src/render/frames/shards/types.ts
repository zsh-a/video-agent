import type {DeckHtmlFrameSequenceCaptureBackend} from '@video-agent/renderer-html'

export interface CreateDeckFrameShardPlanProjectOptions {
  frameCaptureBackend?: DeckHtmlFrameSequenceCaptureBackend
  frameShardSize?: number
  projectId: string
  workspaceDir?: string
}

export interface DeckFrameShardPlanShard {
  commandArgs: string[]
  existingFrames: number
  frameCount: number
  frameEnd: number
  frameStart: number
  missingFrameSamples: Array<{frame: number; path: string}>
  missingFrames: number
  shardArtifactPath: string
  status: 'complete' | 'partial' | 'pending'
}

export interface CreateDeckFrameShardPlanProjectResult {
  artifactPath: string
  completeShards: number
  duration: number
  finalizeArgs: string[]
  frameCount: number
  frameShardSize: number
  partialShards: number
  pendingShards: number
  projectDir: string
  projectId: string
  shardCount: number
  shards: DeckFrameShardPlanShard[]
  status: 'planned'
}

export interface CreateDeckFrameShardBatchProjectOptions {
  chromiumCommand?: string[]
  frameCaptureBackend?: DeckHtmlFrameSequenceCaptureBackend
  frameConcurrency?: number
  frameShardSize?: number
  playwrightCommand?: string[]
  projectId: string
  shardConcurrency?: number
  shardRetryDelayMs?: number
  shardRetries?: number
  workspaceDir?: string
}

export interface DeckFrameShardBatchShard {
  artifactPath?: string
  attempts: number
  capturedFrames: number
  error?: string
  frameCount: number
  frameEnd: number
  frameStart: number
  skippedFrames: number
  status: 'complete' | 'failed'
}

export interface CreateDeckFrameShardBatchProjectResult {
  artifactPath: string
  completedShards: number
  failedShards: number
  frameCapturedCount: number
  frameConcurrency: number
  frameCount: number
  frameManifestPath: string
  frameShardSize: number
  frameSkippedCount: number
  htmlEntryPath: string
  htmlOutputDir: string
  projectDir: string
  projectId: string
  renderer: DeckHtmlFrameSequenceCaptureBackend
  shardConcurrency: number
  shardCount: number
  shardRetryDelayMs: number
  shardRetries: number
  shards: DeckFrameShardBatchShard[]
  status: 'completed' | 'partial'
}
