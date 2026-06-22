import type {DeckRendererBackend} from '../render/deck-renderers.js'
import {TIMED_DECK_ARTIFACT_NAME} from '@video-agent/ir'

export {TIMED_DECK_ARTIFACT_NAME}

export const DECK_FRAME_MANIFEST_ARTIFACT_NAME = 'deck-frame-manifest.json' as const
export const DECK_FRAME_SHARD_BATCH_ARTIFACT_NAME = 'deck-frame-shard-batch.json' as const
export const DECK_FRAME_SHARD_PLAN_ARTIFACT_NAME = 'deck-frame-shard-plan.json' as const
export const DECK_KEYFRAMES_ARTIFACT_NAME = 'deck-keyframes.json' as const
export const DECK_RENDERER_MOTION_CANVAS_ARTIFACT_NAME = 'deck-renderer-motion-canvas.json' as const
export const DECK_RENDERER_REMOTION_ARTIFACT_NAME = 'deck-renderer-remotion.json' as const
export const DECK_RENDERER_REMOTION_OUTPUT_ARTIFACT_NAME = 'deck-renderer-remotion-output.json' as const

export const DECK_RENDERER_BACKEND_ARTIFACT_NAMES = [
  DECK_RENDERER_MOTION_CANVAS_ARTIFACT_NAME,
  DECK_RENDERER_REMOTION_ARTIFACT_NAME,
] as const
export type DeckRendererBackendArtifactName = (typeof DECK_RENDERER_BACKEND_ARTIFACT_NAMES)[number]

export const DECK_RENDERER_BACKEND_ARTIFACT_NAME_BY_BACKEND = {
  'motion-canvas': DECK_RENDERER_MOTION_CANVAS_ARTIFACT_NAME,
  remotion: DECK_RENDERER_REMOTION_ARTIFACT_NAME,
} as const satisfies Record<DeckRendererBackend, DeckRendererBackendArtifactName>

export function deckRendererBackendArtifactName(backend: DeckRendererBackend): DeckRendererBackendArtifactName {
  return DECK_RENDERER_BACKEND_ARTIFACT_NAME_BY_BACKEND[backend]
}

export const DECK_FRAME_SHARD_COMPLETE_STATUS = 'complete' as const
export const DECK_FRAME_SHARD_PARTIAL_STATUS = 'partial' as const
export const DECK_FRAME_SHARD_PENDING_STATUS = 'pending' as const
export const DECK_FRAME_SHARD_PLAN_STATUSES = [
  DECK_FRAME_SHARD_COMPLETE_STATUS,
  DECK_FRAME_SHARD_PARTIAL_STATUS,
  DECK_FRAME_SHARD_PENDING_STATUS,
] as const
export type DeckFrameShardPlanStatus = (typeof DECK_FRAME_SHARD_PLAN_STATUSES)[number]

export const DECK_FRAME_SHARD_FAILED_STATUS = 'failed' as const
export const DECK_FRAME_SHARD_BATCH_SHARD_STATUSES = [
  DECK_FRAME_SHARD_COMPLETE_STATUS,
  DECK_FRAME_SHARD_FAILED_STATUS,
] as const
export type DeckFrameShardBatchShardStatus = (typeof DECK_FRAME_SHARD_BATCH_SHARD_STATUSES)[number]

export const DECK_FRAME_SHARD_BATCH_COMPLETED_STATUS = 'completed' as const
export const DECK_FRAME_SHARD_BATCH_PARTIAL_STATUS = DECK_FRAME_SHARD_PARTIAL_STATUS
export const DECK_FRAME_SHARD_BATCH_STATUSES = [
  DECK_FRAME_SHARD_BATCH_COMPLETED_STATUS,
  DECK_FRAME_SHARD_BATCH_PARTIAL_STATUS,
] as const
export type DeckFrameShardBatchStatus = (typeof DECK_FRAME_SHARD_BATCH_STATUSES)[number]

export const DECK_KEYFRAME_CAPTURE_MODE_BROWSER = 'browser-keyframes' as const
export const DECK_KEYFRAME_CAPTURE_MODE_FINAL_VIDEO = 'final-video' as const
export const DECK_KEYFRAME_CAPTURE_MODE_FRAME_SEQUENCE = 'frame-sequence' as const
export const DECK_KEYFRAME_CAPTURE_MODES = [
  DECK_KEYFRAME_CAPTURE_MODE_BROWSER,
  DECK_KEYFRAME_CAPTURE_MODE_FINAL_VIDEO,
  DECK_KEYFRAME_CAPTURE_MODE_FRAME_SEQUENCE,
] as const
export type DeckKeyframeCaptureMode = (typeof DECK_KEYFRAME_CAPTURE_MODES)[number]

export const DECK_KEYFRAME_SOURCES = [DECK_FRAME_MANIFEST_ARTIFACT_NAME, TIMED_DECK_ARTIFACT_NAME] as const
export type DeckKeyframeSource = (typeof DECK_KEYFRAME_SOURCES)[number]
