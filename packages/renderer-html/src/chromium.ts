import type {TimedDeck} from '@video-agent/ir'

import {runProcess} from '@video-agent/media'
import {mkdir, stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

import {writeDeckHtmlCapturePage} from './deck/compiler.js'
import {deckCanvasSize} from './deck/format.js'

export interface DeckHtmlFrame {
  duration: number
  path: string
  slideId: string
  time: number
}

export interface CaptureDeckHtmlFramesOptions {
  chromiumCommand?: string[]
  outputDir: string
  projectDir: string
  timedDeck: TimedDeck
}

export interface CaptureDeckHtmlFramesResult {
  command: string[]
  frames: DeckHtmlFrame[]
  outputDir: string
  viewport: {
    height: number
    width: number
  }
}

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
    const start = timing?.start ?? 0
    const duration = Math.max(0.1, timing === undefined ? slide.duration ?? 1 : timing.end - timing.start)

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

function resolveChromiumCommand(command: string[] | undefined): string[] {
  return command === undefined ? ['chromium'] : command
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
