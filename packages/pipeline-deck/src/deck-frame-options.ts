import type {DeckHtmlFrameSequenceCaptureBackend} from '@video-agent/renderer-html'

export const DEFAULT_DECK_FRAME_CONCURRENCY = 1
export const DEFAULT_DECK_RENDER_FPS = 30
export const DEFAULT_DECK_FRAME_SHARD_SIZE = 300

export function deckFrameVideoRenderer(backend: DeckHtmlFrameSequenceCaptureBackend): 'chromium+ffmpeg' | 'playwright+ffmpeg' {
  return backend === 'playwright' ? 'playwright+ffmpeg' : 'chromium+ffmpeg'
}

export function normalizeDeckFrameConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_DECK_FRAME_CONCURRENCY
  }

  return Math.max(1, Math.floor(value))
}

export function normalizeDeckFrameShardSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_DECK_FRAME_SHARD_SIZE
  }

  return Math.max(1, Math.floor(value))
}

export function normalizeDeckShardConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 1
  }

  return Math.max(1, Math.floor(value))
}

export function normalizeDeckShardRetries(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.floor(value))
}

export function normalizeDeckShardRetryDelayMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.floor(value))
}

export function normalizeDeckRendererFps(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_DECK_RENDER_FPS
  }

  return Math.max(1, Math.floor(value))
}

export function normalizeDeckFrameRange(options: {frameEnd?: number; frameStart?: number}): {end?: number; start?: number} | undefined {
  if (options.frameStart === undefined && options.frameEnd === undefined) {
    return undefined
  }

  const start = options.frameStart === undefined || !Number.isFinite(options.frameStart) ? undefined : Math.max(1, Math.floor(options.frameStart))
  const end = options.frameEnd === undefined || !Number.isFinite(options.frameEnd) ? undefined : Math.max(1, Math.floor(options.frameEnd))

  if (start !== undefined && end !== undefined && end < start) {
    throw new RangeError(`--frame-end (${end}) must be greater than or equal to --frame-start (${start}).`)
  }

  return {end, start}
}

export function createDeckFrameShardRanges(frameCount: number, frameShardSize: number): Array<{end: number; start: number}> {
  const ranges: Array<{end: number; start: number}> = []

  for (let start = 1; start <= frameCount; start += frameShardSize) {
    ranges.push({
      end: Math.min(frameCount, start + frameShardSize - 1),
      start,
    })
  }

  return ranges
}
