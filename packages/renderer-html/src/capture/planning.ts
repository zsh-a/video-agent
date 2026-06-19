import type {TimedDeck} from '@video-agent/ir'
import type {DeckHtmlFrameSequenceFrame, DeckHtmlKeyframe} from './types.js'

import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

export function createDeckHtmlFrameSequence(input: {
  fps: number
  outputDir: string
  timedDeck: TimedDeck
}): DeckHtmlFrameSequenceFrame[] {
  const fps = Math.max(1, input.fps)
  const duration = Math.max(0, input.timedDeck.timings.at(-1)?.end ?? 0)
  const frameCount = Math.max(1, Math.ceil(duration * fps))

  return Array.from({length: frameCount}, (_, index) => {
    const time = round(index / fps)

    return {
      frame: index + 1,
      path: resolve(input.outputDir, `frame-${String(index + 1).padStart(6, '0')}.png`),
      slideId: slideIdAtTime(input.timedDeck, time),
      time,
    }
  })
}

export function createDeckHtmlKeyframes(input: {
  fps: number
  outputDir: string
  timedDeck: TimedDeck
}): DeckHtmlKeyframe[] {
  return selectDeckHtmlKeyframes(createDeckHtmlFrameSequence(input)).map((frame) => ({
    ...frame,
    path: resolve(input.outputDir, `keyframe-${String(frame.frame).padStart(6, '0')}.png`),
  }))
}

export function selectDeckHtmlKeyframes(frames: Array<{frame: number; path: string; slideId: string; time: number}>): DeckHtmlKeyframe[] {
  if (frames.length === 0) {
    return []
  }

  const targets = new Map<number, DeckHtmlKeyframe>()

  addDeckHtmlKeyframeTarget(targets, frames[0], 'start')
  addDeckHtmlKeyframeTarget(targets, frames[Math.floor(frames.length / 2)], 'middle')
  addDeckHtmlKeyframeTarget(targets, frames[frames.length - 1], 'end')

  const seenSlides = new Set<string>()
  for (const frame of frames) {
    if (seenSlides.has(frame.slideId)) {
      continue
    }

    seenSlides.add(frame.slideId)
    addDeckHtmlKeyframeTarget(targets, frame, `slide:${frame.slideId}:start`)
  }

  return [...targets.values()].sort((a, b) => a.frame - b.frame)
}

export function buildChromiumScreenshotArgs(input: {
  command: string[]
  entryHtml: string
  outputPath: string
  slideId: string
  time: number
  viewport: {height: number; width: number}
}): string[] {
  const url = pathToFileURL(input.entryHtml)

  url.searchParams.set('capture', 'slide')
  url.searchParams.set('slide', input.slideId)
  url.searchParams.set('time', String(input.time))

  return [
    ...input.command,
    '--headless=new',
    '--disable-background-networking',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-sandbox',
    '--allow-file-access-from-files',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=1000',
    `--window-size=${input.viewport.width},${input.viewport.height}`,
    `--screenshot=${input.outputPath}`,
    url.href,
  ]
}

export function deckFramePreviewTime(start: number, duration: number): number {
  const safeDuration = Math.max(0.001, duration)
  const exitMargin = Math.min(0.32, safeDuration * 0.12)
  const minPreviewTime = start + Math.min(0.75, safeDuration * 0.45)
  const maxPreviewTime = start + Math.max(0.001, safeDuration - exitMargin - 0.05)
  const targetTime = start + safeDuration * 0.82

  if (maxPreviewTime < minPreviewTime) {
    return round(start + safeDuration * 0.5)
  }

  return round(clamp(targetTime, minPreviewTime, maxPreviewTime))
}

function addDeckHtmlKeyframeTarget(targets: Map<number, DeckHtmlKeyframe>, frame: {frame: number; path: string; slideId: string; time: number} | undefined, label: string): void {
  if (frame === undefined || targets.has(frame.frame)) {
    return
  }

  targets.set(frame.frame, {
    frame: frame.frame,
    label,
    path: frame.path,
    slideId: frame.slideId,
    time: frame.time,
  })
}

function slideIdAtTime(timedDeck: TimedDeck, time: number): string {
  const timing = timedDeck.timings.find((item, index) => {
    const isLast = index === timedDeck.timings.length - 1

    return time >= item.start && (time < item.end || isLast)
  })

  return timing?.slideId ?? timedDeck.deck.slides[0]?.slideId ?? 'slide-001'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
