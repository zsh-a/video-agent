import type {LongVideoChunkPlan, LongVideoChunkPlanDefaults, MediaInfo} from '@video-agent/ir'

import {LongVideoChunkPlanDefaultsSchema, LongVideoChunkPlanSchema} from '@video-agent/ir'

export const DEFAULT_LONG_VIDEO_CHUNK_OPTIONS = {
  asrChunking: true,
  chunkDuration: 300,
  chunkOverlap: 10,
  frameSampleFps: 1,
  sceneDetection: true,
  vlmBatchSize: 16,
  vlmFrameSampleFps: 0.2,
} satisfies LongVideoChunkPlanDefaults

export type LongVideoChunkPlanOptions = Partial<LongVideoChunkPlanDefaults>

export function createLongVideoChunkPlan(mediaInfo: MediaInfo, options: LongVideoChunkPlanOptions = {}): LongVideoChunkPlan {
  const defaults = LongVideoChunkPlanDefaultsSchema.parse({
    ...DEFAULT_LONG_VIDEO_CHUNK_OPTIONS,
    ...options,
  })
  const sourceDuration = resolveSourceDuration(mediaInfo)

  const chunks: LongVideoChunkPlan['chunks'] = []

  for (let start = 0, index = 0; start < sourceDuration; start = roundSeconds(start + defaults.chunkDuration), index += 1) {
    const end = roundSeconds(Math.min(sourceDuration, start + defaults.chunkDuration))

    if (end <= start) {
      break
    }

    const ordinal = String(index).padStart(3, '0')
    const analysisStart = roundSeconds(Math.max(0, start - defaults.chunkOverlap))
    const analysisEnd = roundSeconds(Math.min(sourceDuration, end + defaults.chunkOverlap))

    chunks.push({
      analysisRange: [analysisStart, analysisEnd],
      artifactPrefix: `chunks/${ordinal}`,
      contentRange: [roundSeconds(start), end],
      duration: roundSeconds(end - start),
      id: `chunk-${ordinal}`,
      index,
    })
  }

  return LongVideoChunkPlanSchema.parse({
    chunks,
    defaults,
    source: mediaInfo.inputPath,
    sourceDuration: roundSeconds(sourceDuration),
    version: 1,
  })
}

function roundSeconds(value: number): number {
  return Number(value.toFixed(6))
}

function resolveSourceDuration(mediaInfo: MediaInfo): number {
  if (mediaInfo.duration !== undefined) {
    if (Number.isFinite(mediaInfo.duration) && mediaInfo.duration > 0) {
      return mediaInfo.duration
    }

    throw new Error('Long video chunk planning requires a positive media duration; no empty chunk-plan fallback is allowed.')
  }

  const streamDurations = mediaInfo.streams
    .map((stream) => stream.duration)
    .filter((duration): duration is number => duration !== undefined)
  const streamDuration = streamDurations.length === 0 ? undefined : Math.max(...streamDurations)

  if (streamDuration !== undefined && Number.isFinite(streamDuration) && streamDuration > 0) {
    return streamDuration
  }

  throw new Error('Long video chunk planning requires media or stream duration from probing; no empty chunk-plan fallback is allowed.')
}
