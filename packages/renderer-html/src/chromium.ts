import type {DeckFormat, TimedDeck} from '@video-agent/ir'

import {runProcess} from '@video-agent/media'
import {mkdir, stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

import {writeDeckHtmlCapturePage} from './deck-compiler.js'

export interface DeckHtmlFrame {
  duration: number
  path: string
  slideId: string
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
  const viewport = deckRenderSize(options.timedDeck.deck.format)
  const timingsBySlide = new Map(options.timedDeck.timings.map((timing) => [timing.slideId, timing]))
  const frames = options.timedDeck.deck.slides.map((slide, index) => {
    const timing = timingsBySlide.get(slide.slideId)

    return {
      duration: Math.max(0.1, timing === undefined ? slide.duration ?? 1 : timing.end - timing.start),
      path: resolve(outputDir, `slide-${String(index + 1).padStart(3, '0')}.png`),
      slideId: slide.slideId,
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
    slideId: input.frame.slideId,
    stylesheetHref: '../styles.css',
    timedDeck: input.timedDeck,
  })
  const args = buildChromiumScreenshotArgs({
    command: input.command,
    entryHtml,
    outputPath: input.frame.path,
    slideId: input.frame.slideId,
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
  viewport: {height: number; width: number}
}): string[] {
  const url = pathToFileURL(input.entryHtml)

  url.searchParams.set('capture', 'slide')
  url.searchParams.set('slide', input.slideId)

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

function resolveChromiumCommand(command: string[] | undefined): string[] {
  return command === undefined ? ['chromium'] : command
}

function deckRenderSize(format: DeckFormat): {height: number; width: number} {
  if (format === 'landscape_1920x1080') {
    return {height: 1080, width: 1920}
  }

  if (format === 'square_1080x1080') {
    return {height: 1080, width: 1080}
  }

  return {height: 1920, width: 1080}
}
