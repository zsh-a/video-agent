import type {DeckHtmlCaptureBackend} from '@video-agent/ir'
import type {DeckFrameShardBatchShardStatus, DeckFrameShardBatchStatus, DeckFrameShardPlanStatus} from '@video-agent/runtime'

export interface CreateDeckFrameShardPlanProjectOptions {
  frameCaptureBackend?: DeckHtmlCaptureBackend
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
  status: DeckFrameShardPlanStatus
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
  frameCaptureBackend?: DeckHtmlCaptureBackend
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
  status: DeckFrameShardBatchShardStatus
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
  renderer: DeckHtmlCaptureBackend
  shardConcurrency: number
  shardCount: number
  shardRetryDelayMs: number
  shardRetries: number
  shards: DeckFrameShardBatchShard[]
  status: DeckFrameShardBatchStatus
}
