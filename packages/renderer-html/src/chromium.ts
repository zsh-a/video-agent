import type {TimedDeck} from '@video-agent/ir'
import type {
  CaptureDeckHtmlFrameSequenceOptions,
  CaptureDeckHtmlFrameSequenceResult,
  CaptureDeckHtmlFramesOptions,
  CaptureDeckHtmlFramesResult,
  CaptureDeckHtmlKeyframesOptions,
  CaptureDeckHtmlKeyframesResult,
  DeckHtmlFrame,
  DeckHtmlFrameSequenceFrame,
} from './capture/types.js'

import {runProcess} from '@video-agent/media'
import {DEFAULT_DECK_HTML_CAPTURE_BACKEND} from '@video-agent/ir'
import {deckCanvasSize, writeDeckHtmlCapturePage} from '@video-agent/renderer-deck'
import {mkdir, stat} from 'node:fs/promises'
import {resolve} from 'node:path'

import {buildChromiumScreenshotArgs, createDeckHtmlFrameSequence, createDeckHtmlKeyframes, deckFramePreviewTime} from './capture/planning.js'
import {isNonEmptyFile, normalizeCaptureConcurrency, normalizeFrameRange, requireCaptureFps, runConcurrent} from './capture/utils.js'
import {captureDeckHtmlFrameSequenceWithPlaywright, captureDeckHtmlKeyframesWithPlaywright} from './capture/playwright.js'

export {buildChromiumScreenshotArgs, createDeckHtmlFrameSequence, createDeckHtmlKeyframes, deckFramePreviewTime, selectDeckHtmlKeyframes} from './capture/planning.js'
export {PlaywrightCaptureError} from './capture/playwright.js'
export type {
  CaptureDeckHtmlFrameSequenceOptions,
  CaptureDeckHtmlFrameSequenceResult,
  CaptureDeckHtmlFramesOptions,
  CaptureDeckHtmlFramesResult,
  CaptureDeckHtmlKeyframesOptions,
  CaptureDeckHtmlKeyframesResult,
  DeckHtmlFrame,
  DeckHtmlFrameSequenceFrame,
  DeckHtmlKeyframe,
  PlaywrightFrameSequenceCaptureManifest,
  PlaywrightKeyframeCaptureManifest,
} from './capture/types.js'

export class ChromiumCaptureError extends Error {
  constructor(
    message: string,
    readonly command: string[],
    readonly stderr: string,
  ) {
    super(message)
  }
}

export async function captureDeckHtmlFrames(options: CaptureDeckHtmlFramesOptions): Promise<CaptureDeckHtmlFramesResult> {
  const outputDir = resolve(options.outputDir)
  const projectDir = resolve(options.projectDir)
  const captureDir = resolve(projectDir, 'capture')
  const command = resolveChromiumCommand(options.chromiumCommand)
  const viewport = deckCanvasSize(options.timedDeck.deck.format)
  const timingsBySlide = new Map(options.timedDeck.timings.map((timing) => [timing.slideId, timing]))
  const frames = options.timedDeck.deck.slides.map((slide, index) => {
    const timing = timingsBySlide.get(slide.slideId)

    if (timing === undefined) {
      throw new Error(`Deck HTML frame capture is missing timing for slide "${slide.slideId}".`)
    }

    const start = timing.start
    const duration = timing.end - timing.start

    if (!Number.isFinite(start) || !Number.isFinite(timing.end) || duration <= 0) {
      throw new Error(`Deck HTML frame capture requires a positive timing duration for slide "${slide.slideId}"; no preview-duration fallback is allowed.`)
    }

    return {
      duration,
      path: resolve(outputDir, `slide-${String(index + 1).padStart(3, '0')}.png`),
      slideId: slide.slideId,
      time: deckFramePreviewTime(start, duration),
    }
  })

  await Promise.all([
    mkdir(outputDir, {recursive: true}),
    mkdir(captureDir, {recursive: true}),
  ])
  await Promise.all(frames.map((frame, index) => captureDeckHtmlFrame({
    captureDir,
    command,
    frame,
    index,
    timedDeck: options.timedDeck,
    viewport,
  })))

  return {
    command,
    frames,
    outputDir,
    viewport,
  }
}

export async function captureDeckHtmlFrameSequence(options: CaptureDeckHtmlFrameSequenceOptions): Promise<CaptureDeckHtmlFrameSequenceResult> {
  const backend = options.backend ?? DEFAULT_DECK_HTML_CAPTURE_BACKEND

  if (backend === 'playwright') {
    return captureDeckHtmlFrameSequenceWithPlaywright(options)
  }

  const outputDir = resolve(options.outputDir)
  const projectDir = resolve(options.projectDir)
  const captureDir = resolve(projectDir, 'capture-sequence')
  const command = resolveChromiumCommand(options.chromiumCommand)
  const viewport = deckCanvasSize(options.timedDeck.deck.format)
  const fps = requireCaptureFps(options.fps)
  const concurrency = normalizeCaptureConcurrency(options.concurrency)
  const frames = createDeckHtmlFrameSequence({
    fps,
    outputDir,
    timedDeck: options.timedDeck,
  })
  const frameRange = normalizeFrameRange({
    end: options.frameEnd,
    frameCount: frames.length,
    start: options.frameStart,
  })
  const captureFrames = frames.filter((frame) => frame.frame >= frameRange.start && frame.frame <= frameRange.end)

  await Promise.all([
    mkdir(outputDir, {recursive: true}),
    mkdir(captureDir, {recursive: true}),
  ])

  let capturedFrames = 0
  let skippedFrames = 0

  await runConcurrent(captureFrames, concurrency, async (frame) => {
    if (options.reuseExistingFrames === true && await isNonEmptyFile(frame.path)) {
      skippedFrames += 1
      return
    }

    await captureDeckHtmlSequenceFrame({
      captureDir,
      command,
      frame,
      timedDeck: options.timedDeck,
      viewport,
    })
    capturedFrames += 1
  })

  return {
    backend: 'chromium',
    capturedFrames,
    command,
    concurrency,
    duration: round(frames.length / fps),
    frameEnd: frameRange.end,
    frameStart: frameRange.start,
    fps,
    frames,
    outputDir,
    pattern: resolve(outputDir, 'frame-%06d.png'),
    skippedFrames,
    viewport,
  }
}

export async function captureDeckHtmlKeyframes(options: CaptureDeckHtmlKeyframesOptions): Promise<CaptureDeckHtmlKeyframesResult> {
  const backend = options.backend ?? DEFAULT_DECK_HTML_CAPTURE_BACKEND

  if (backend === 'playwright') {
    return captureDeckHtmlKeyframesWithPlaywright(options)
  }

  const outputDir = resolve(options.outputDir)
  const projectDir = resolve(options.projectDir)
  const captureDir = resolve(projectDir, 'capture-keyframes')
  const command = resolveChromiumCommand(options.chromiumCommand)
  const viewport = deckCanvasSize(options.timedDeck.deck.format)
  const fps = requireCaptureFps(options.fps)
  const concurrency = normalizeCaptureConcurrency(options.concurrency)
  const frames = createDeckHtmlKeyframes({
    fps,
    outputDir,
    timedDeck: options.timedDeck,
  })

  await Promise.all([
    mkdir(outputDir, {recursive: true}),
    mkdir(captureDir, {recursive: true}),
  ])

  let capturedFrames = 0

  await runConcurrent(frames, concurrency, async (frame) => {
    await captureDeckHtmlSequenceFrame({
      captureDir,
      command,
      frame,
      timedDeck: options.timedDeck,
      viewport,
    })
    capturedFrames += 1
  })

  return {
    backend: 'chromium',
    capturedFrames,
    command,
    concurrency,
    duration: round(createDeckHtmlFrameSequence({
      fps,
      outputDir,
      timedDeck: options.timedDeck,
    }).length / fps),
    fps,
    frames,
    outputDir,
    viewport,
  }
}

async function captureDeckHtmlFrame(input: {
  captureDir: string
  command: string[]
  frame: DeckHtmlFrame
  index: number
  timedDeck: TimedDeck
  viewport: {height: number; width: number}
}): Promise<void> {
  const entryHtml = await writeDeckHtmlCapturePage({
    outputPath: resolve(input.captureDir, `slide-${String(input.index + 1).padStart(3, '0')}.html`),
    runtimeHref: '../runtime.js',
    slideId: input.frame.slideId,
    stylesheetHref: '../styles.css',
    timedDeck: input.timedDeck,
  })
  const args = buildChromiumScreenshotArgs({
    command: input.command,
    entryHtml,
    outputPath: input.frame.path,
    slideId: input.frame.slideId,
    time: input.frame.time,
    viewport: input.viewport,
  })
  const result = await runProcess(args)

  if (result.code !== 0) {
    throw new ChromiumCaptureError(`Chromium failed with exit code ${result.code}`, args, result.stderr)
  }

  const info = await stat(input.frame.path)

  if (info.size <= 0) {
    throw new ChromiumCaptureError('Chromium screenshot output is empty.', args, result.stderr)
  }
}

async function captureDeckHtmlSequenceFrame(input: {
  captureDir: string
  command: string[]
  frame: DeckHtmlFrameSequenceFrame
  timedDeck: TimedDeck
  viewport: {height: number; width: number}
}): Promise<void> {
  const entryHtml = await writeDeckHtmlCapturePage({
    outputPath: resolve(input.captureDir, `frame-${String(input.frame.frame).padStart(6, '0')}.html`),
    runtimeHref: '../runtime.js',
    slideId: input.frame.slideId,
    stylesheetHref: '../styles.css',
    timedDeck: input.timedDeck,
  })
  const args = buildChromiumScreenshotArgs({
    command: input.command,
    entryHtml,
    outputPath: input.frame.path,
    slideId: input.frame.slideId,
    time: input.frame.time,
    viewport: input.viewport,
  })
  const result = await runProcess(args)

  if (result.code !== 0) {
    throw new ChromiumCaptureError(`Chromium failed with exit code ${result.code}`, args, result.stderr)
  }

  const info = await stat(input.frame.path)

  if (info.size <= 0) {
    throw new ChromiumCaptureError('Chromium screenshot output is empty.', args, result.stderr)
  }
}

function resolveChromiumCommand(command: string[] | undefined): string[] {
  return command === undefined ? ['chromium'] : command
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
