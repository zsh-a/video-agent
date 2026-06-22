export const DEFAULT_DECK_FRAME_CONCURRENCY = 1
export const DEFAULT_DECK_RENDER_FPS = 30
export const DEFAULT_DECK_FRAME_SHARD_SIZE = 300

export function normalizeDeckFrameConcurrency(value: number | undefined): number {
  return readPositiveIntegerOption(value, DEFAULT_DECK_FRAME_CONCURRENCY, 'Deck frame concurrency')
}

export function normalizeDeckFrameShardSize(value: number | undefined): number {
  return readPositiveIntegerOption(value, DEFAULT_DECK_FRAME_SHARD_SIZE, 'Deck frame shard size')
}

export function normalizeDeckShardConcurrency(value: number | undefined): number {
  return readPositiveIntegerOption(value, 1, 'Deck shard concurrency')
}

export function normalizeDeckShardRetries(value: number | undefined): number {
  return readNonNegativeIntegerOption(value, 0, 'Deck shard retries')
}

export function normalizeDeckShardRetryDelayMs(value: number | undefined): number {
  return readNonNegativeIntegerOption(value, 0, 'Deck shard retry delay ms')
}

export function normalizeDeckRendererFps(value: number | undefined): number {
  return readPositiveIntegerOption(value, DEFAULT_DECK_RENDER_FPS, 'Deck renderer fps')
}

export function normalizeDeckFrameRange(options: {frameEnd?: number; frameStart?: number}): {end?: number; start?: number} | undefined {
  if (options.frameStart === undefined && options.frameEnd === undefined) {
    return undefined
  }

  const start = readOptionalPositiveIntegerOption(options.frameStart, 'Deck frameStart')
  const end = readOptionalPositiveIntegerOption(options.frameEnd, 'Deck frameEnd')

  if (start !== undefined && end !== undefined && end < start) {
    throw new RangeError(`Deck frameEnd (${end}) must be greater than or equal to frameStart (${start}).`)
  }

  return {end, start}
}

export function createDeckFrameShardRanges(frameCount: number, frameShardSize: number): Array<{end: number; start: number}> {
  assertPositiveInteger(frameCount, 'Deck frame count')
  assertPositiveInteger(frameShardSize, 'Deck frame shard size')

  const ranges: Array<{end: number; start: number}> = []

  for (let start = 1; start <= frameCount; start += frameShardSize) {
    ranges.push({
      end: Math.min(frameCount, start + frameShardSize - 1),
      start,
    })
  }

  return ranges
}

function readPositiveIntegerOption(value: number | undefined, defaultValue: number, label: string): number {
  if (value === undefined) {
    return defaultValue
  }

  assertPositiveInteger(value, label)

  return value
}

function readNonNegativeIntegerOption(value: number | undefined, defaultValue: number, label: string): number {
  if (value === undefined) {
    return defaultValue
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer; no runtime integer coercion fallback is allowed. Received: ${String(value)}`)
  }

  return value
}

function readOptionalPositiveIntegerOption(value: number | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  assertPositiveInteger(value, label)

  return value
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer; no runtime integer coercion fallback is allowed. Received: ${String(value)}`)
  }
}
