import {stat} from 'node:fs/promises'

export async function runConcurrent<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length) {
      const item = items[index]
      index += 1

      if (item !== undefined) {
        // eslint-disable-next-line no-await-in-loop
        await task(item)
      }
    }
  }

  await Promise.all(Array.from({length: Math.min(concurrency, Math.max(1, items.length))}, () => worker()))
}

export function normalizeCaptureConcurrency(value: number | undefined): number {
  if (value === undefined) {
    return 1
  }

  assertPositiveInteger(value, 'Deck HTML capture concurrency')

  return value
}

export function requireCaptureFps(value: number | undefined): number {
  if (value === undefined) {
    throw new Error('Deck HTML capture requires an explicit positive fps; no renderer-level 30fps fallback is allowed.')
  }

  assertPositiveInteger(value, 'Deck HTML capture fps')

  return value
}

export function normalizeFrameRange(input: {end: number | undefined; frameCount: number; start: number | undefined}): {end: number; start: number} {
  assertPositiveInteger(input.frameCount, 'Deck HTML frame count')

  const start = readPositiveIntegerWithDefault(input.start, 1, 'Frame range start')
  const end = readPositiveIntegerWithDefault(input.end, input.frameCount, 'Frame range end')

  if (start > input.frameCount) {
    throw new RangeError(`Frame range start (${start}) must be less than or equal to frame count (${input.frameCount}).`)
  }

  if (end > input.frameCount) {
    throw new RangeError(`Frame range end (${end}) must be less than or equal to frame count (${input.frameCount}).`)
  }

  if (end < start) {
    throw new RangeError(`Frame range end (${end}) must be greater than or equal to start (${start}).`)
  }

  return {end, start}
}

function readPositiveIntegerWithDefault(value: number | undefined, defaultValue: number, label: string): number {
  if (value === undefined) {
    return defaultValue
  }

  assertPositiveInteger(value, label)

  return value
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer; no runtime integer coercion fallback is allowed. Received: ${String(value)}`)
  }
}

export async function isNonEmptyFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path)

    return info.size > 0
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }

    throw error
  }
}
