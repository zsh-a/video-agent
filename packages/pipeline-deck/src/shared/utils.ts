import type {SlideTiming, TimedDeck} from '@video-agent/ir'

import {access} from 'node:fs/promises'

export async function assertFileExists(path: string, message = `ENOENT: no such file or directory, access '${path}'`): Promise<void> {
  try {
    await access(path)
  } catch {
    throw Object.assign(new Error(message), {code: 'ENOENT'})
  }
}

export function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function requireTimedDeckDuration(timedDeck: TimedDeck, context: string): number {
  return requireSlideTimingsDuration(timedDeck.timings, context)
}

export function requireSlideTimingDuration(timing: SlideTiming, context: string): number {
  if (!Number.isFinite(timing.start) || timing.start < 0) {
    throw new Error(`${context} requires a finite non-negative timing start for slide "${timing.slideId}"; no timing clamp fallback is allowed. Received: ${String(timing.start)}`)
  }

  if (!Number.isFinite(timing.end) || timing.end <= timing.start) {
    throw new Error(`${context} requires timing end to be greater than start for slide "${timing.slideId}"; no timing clamp fallback is allowed. Received start=${String(timing.start)} end=${String(timing.end)}`)
  }

  return timing.end - timing.start
}

export function requireSlideTimingsDuration(timings: SlideTiming[], context: string): number {
  const lastTiming = timings.at(-1)

  if (lastTiming === undefined) {
    throw new Error(`${context} requires at least one slide timing; no zero-duration Deck timing fallback is allowed.`)
  }

  timings.forEach((timing) => requireSlideTimingDuration(timing, context))

  return lastTiming.end
}
