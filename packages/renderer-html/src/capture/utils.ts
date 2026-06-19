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
  if (value === undefined || !Number.isFinite(value)) {
    return 1
  }

  return Math.max(1, Math.floor(value))
}

export function normalizeFrameRange(input: {end: number | undefined; frameCount: number; start: number | undefined}): {end: number; start: number} {
  const start = input.start === undefined || !Number.isFinite(input.start) ? 1 : Math.max(1, Math.floor(input.start))
  const end = input.end === undefined || !Number.isFinite(input.end) ? input.frameCount : Math.min(input.frameCount, Math.max(1, Math.floor(input.end)))

  if (end < start) {
    throw new RangeError(`Frame range end (${end}) must be greater than or equal to start (${start}).`)
  }

  return {end, start}
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
