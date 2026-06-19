import type {TimedDeck} from '@video-agent/ir'

import {runProcess} from '@video-agent/media'
import {mkdir, stat, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

import {writeDeckHtmlCapturePage} from './deck/compiler/index.js'
import {deckCanvasSize} from './deck/format.js'

export interface DeckHtmlFrame {
  duration: number
  path: string
  slideId: string
  time: number
}

export interface DeckHtmlFrameSequenceFrame {
  frame: number
  path: string
  slideId: string
  time: number
}

export interface DeckHtmlKeyframe {
  frame: number
  label: string
  path: string
  slideId: string
  time: number
}

export type DeckHtmlKeyframeCaptureBackend = 'chromium' | 'playwright'
export type DeckHtmlFrameSequenceCaptureBackend = 'chromium' | 'playwright'

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

export interface CaptureDeckHtmlFrameSequenceOptions {
  backend?: DeckHtmlFrameSequenceCaptureBackend
  chromiumCommand?: string[]
  concurrency?: number
  frameEnd?: number
  frameStart?: number
  fps?: number
  outputDir: string
  playwrightCommand?: string[]
  projectDir: string
  reuseExistingFrames?: boolean
  timedDeck: TimedDeck
}

export interface CaptureDeckHtmlFrameSequenceResult {
  backend: DeckHtmlFrameSequenceCaptureBackend
  capturedFrames: number
  command: string[]
  concurrency: number
  frameEnd: number
  frameStart: number
  duration: number
  fps: number
  frames: DeckHtmlFrameSequenceFrame[]
  outputDir: string
  pattern: string
  skippedFrames: number
  viewport: {
    height: number
    width: number
  }
}

export interface CaptureDeckHtmlKeyframesOptions {
  backend?: DeckHtmlKeyframeCaptureBackend
  chromiumCommand?: string[]
  concurrency?: number
  fps?: number
  outputDir: string
  playwrightCommand?: string[]
  projectDir: string
  timedDeck: TimedDeck
}

export interface CaptureDeckHtmlKeyframesResult {
  backend: DeckHtmlKeyframeCaptureBackend
  capturedFrames: number
  command: string[]
  concurrency: number
  duration: number
  fps: number
  frames: DeckHtmlKeyframe[]
  outputDir: string
  viewport: {
    height: number
    width: number
  }
}

export interface PlaywrightKeyframeCaptureManifest {
  frames: Array<DeckHtmlKeyframe & {url: string}>
  generatedAt: string
  viewport: {
    height: number
    width: number
  }
  version: 1
}

export interface PlaywrightFrameSequenceCaptureManifest {
  frames: Array<DeckHtmlFrameSequenceFrame & {url: string}>
  generatedAt: string
  viewport: {
    height: number
    width: number
  }
  version: 1
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

export class PlaywrightCaptureError extends Error {
  constructor(
    message: string,
    readonly command: string[],
    readonly stderr: string,
  ) {
    super(formatCaptureErrorMessage(message, stderr))
  }
}

function formatCaptureErrorMessage(message: string, stderr: string): string {
  const detail = stderr.trim()

  if (detail === '') {
    return message
  }

  return `${message}: ${detail}`
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

export async function captureDeckHtmlFrameSequence(options: CaptureDeckHtmlFrameSequenceOptions): Promise<CaptureDeckHtmlFrameSequenceResult> {
  const backend = options.backend ?? 'playwright'

  if (backend === 'playwright') {
    return captureDeckHtmlFrameSequenceWithPlaywright(options)
  }

  const outputDir = resolve(options.outputDir)
  const projectDir = resolve(options.projectDir)
  const captureDir = resolve(projectDir, 'capture-sequence')
  const command = resolveChromiumCommand(options.chromiumCommand)
  const viewport = deckCanvasSize(options.timedDeck.deck.format)
  const fps = options.fps ?? 30
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
  const backend = options.backend ?? 'playwright'

  if (backend === 'playwright') {
    return captureDeckHtmlKeyframesWithPlaywright(options)
  }

  const outputDir = resolve(options.outputDir)
  const projectDir = resolve(options.projectDir)
  const captureDir = resolve(projectDir, 'capture-keyframes')
  const command = resolveChromiumCommand(options.chromiumCommand)
  const viewport = deckCanvasSize(options.timedDeck.deck.format)
  const fps = options.fps ?? 30
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

async function captureDeckHtmlFrameSequenceWithPlaywright(options: CaptureDeckHtmlFrameSequenceOptions): Promise<CaptureDeckHtmlFrameSequenceResult> {
  const outputDir = resolve(options.outputDir)
  const projectDir = resolve(options.projectDir)
  const captureDir = resolve(projectDir, 'capture-sequence-playwright')
  const viewport = deckCanvasSize(options.timedDeck.deck.format)
  const fps = options.fps ?? 30
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
  const skippedFrames: DeckHtmlFrameSequenceFrame[] = []
  const pendingFrames: DeckHtmlFrameSequenceFrame[] = []

  await Promise.all([
    mkdir(outputDir, {recursive: true}),
    mkdir(captureDir, {recursive: true}),
  ])

  for (const frame of captureFrames) {
    // eslint-disable-next-line no-await-in-loop
    if (options.reuseExistingFrames === true && await isNonEmptyFile(frame.path)) {
      skippedFrames.push(frame)
    } else {
      pendingFrames.push(frame)
    }
  }

  let command: string[] = []

  if (pendingFrames.length > 0) {
    const manifest = await writePlaywrightFrameSequenceCaptureManifest({
      captureDir,
      frames: pendingFrames,
      timedDeck: options.timedDeck,
      viewport,
    })
    const runnerPath = resolve(captureDir, 'playwright-frame-sequence-capture.mjs')

    if (options.playwrightCommand === undefined) {
      await writeFile(runnerPath, createPlaywrightFrameSequenceCaptureRunner(), 'utf8')
    }

    command = [...(options.playwrightCommand ?? [process.execPath, runnerPath]), manifest.path]
    const result = await runProcess(command)

    if (result.code !== 0) {
      throw new PlaywrightCaptureError(`Playwright frame sequence capture failed with exit code ${result.code}`, command, result.stderr)
    }

    await assertPlaywrightFrameOutputs(pendingFrames, command, result.stderr)
  }

  return {
    backend: 'playwright',
    capturedFrames: pendingFrames.length,
    command,
    concurrency,
    duration: round(frames.length / fps),
    frameEnd: frameRange.end,
    frameStart: frameRange.start,
    fps,
    frames,
    outputDir,
    pattern: resolve(outputDir, 'frame-%06d.png'),
    skippedFrames: skippedFrames.length,
    viewport,
  }
}

async function captureDeckHtmlKeyframesWithPlaywright(options: CaptureDeckHtmlKeyframesOptions): Promise<CaptureDeckHtmlKeyframesResult> {
  const outputDir = resolve(options.outputDir)
  const projectDir = resolve(options.projectDir)
  const captureDir = resolve(projectDir, 'capture-keyframes-playwright')
  const viewport = deckCanvasSize(options.timedDeck.deck.format)
  const fps = options.fps ?? 30
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

  const manifest = await writePlaywrightKeyframeCaptureManifest({
    captureDir,
    frames,
    timedDeck: options.timedDeck,
    viewport,
  })
  const runnerPath = resolve(captureDir, 'playwright-keyframe-capture.mjs')

  if (options.playwrightCommand === undefined) {
    await writeFile(runnerPath, createPlaywrightKeyframeCaptureRunner(), 'utf8')
  }

  const command = [...(options.playwrightCommand ?? [process.execPath, runnerPath]), manifest.path]
  const result = await runProcess(command)

  if (result.code !== 0) {
    throw new PlaywrightCaptureError(`Playwright keyframe capture failed with exit code ${result.code}`, command, result.stderr)
  }

  await Promise.all(frames.map(async (frame) => {
    const info = await stat(frame.path)

    if (info.size <= 0) {
      throw new PlaywrightCaptureError('Playwright keyframe screenshot output is empty.', command, result.stderr)
    }
  }))

  return {
    backend: 'playwright',
    capturedFrames: frames.length,
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

async function writePlaywrightKeyframeCaptureManifest(input: {
  captureDir: string
  frames: DeckHtmlKeyframe[]
  timedDeck: TimedDeck
  viewport: {height: number; width: number}
}): Promise<{manifest: PlaywrightKeyframeCaptureManifest; path: string}> {
  const frames = await Promise.all(input.frames.map(async (frame) => {
    const entryHtml = await writeDeckHtmlCapturePage({
      outputPath: resolve(input.captureDir, `keyframe-${String(frame.frame).padStart(6, '0')}.html`),
      runtimeHref: '../runtime.js',
      slideId: frame.slideId,
      stylesheetHref: '../styles.css',
      timedDeck: input.timedDeck,
    })
    const url = pathToFileURL(entryHtml)

    url.searchParams.set('capture', 'slide')
    url.searchParams.set('slide', frame.slideId)
    url.searchParams.set('time', String(frame.time))

    return {
      ...frame,
      url: url.href,
    }
  }))
  const manifest: PlaywrightKeyframeCaptureManifest = {
    frames,
    generatedAt: new Date().toISOString(),
    version: 1,
    viewport: input.viewport,
  }
  const path = resolve(input.captureDir, 'playwright-keyframes.json')

  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  return {manifest, path}
}

async function writePlaywrightFrameSequenceCaptureManifest(input: {
  captureDir: string
  frames: DeckHtmlFrameSequenceFrame[]
  timedDeck: TimedDeck
  viewport: {height: number; width: number}
}): Promise<{manifest: PlaywrightFrameSequenceCaptureManifest; path: string}> {
  const frames = await Promise.all(input.frames.map(async (frame) => {
    const entryHtml = await writeDeckHtmlCapturePage({
      outputPath: resolve(input.captureDir, `frame-${String(frame.frame).padStart(6, '0')}.html`),
      runtimeHref: '../runtime.js',
      slideId: frame.slideId,
      stylesheetHref: '../styles.css',
      timedDeck: input.timedDeck,
    })
    const url = pathToFileURL(entryHtml)

    url.searchParams.set('capture', 'slide')
    url.searchParams.set('slide', frame.slideId)
    url.searchParams.set('time', String(frame.time))

    return {
      ...frame,
      url: url.href,
    }
  }))
  const manifest: PlaywrightFrameSequenceCaptureManifest = {
    frames,
    generatedAt: new Date().toISOString(),
    version: 1,
    viewport: input.viewport,
  }
  const firstFrame = frames.at(0)?.frame ?? 1
  const lastFrame = frames.at(-1)?.frame ?? firstFrame
  const path = resolve(input.captureDir, `playwright-frame-sequence-${String(firstFrame).padStart(6, '0')}-${String(lastFrame).padStart(6, '0')}.json`)

  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  return {manifest, path}
}

function createPlaywrightKeyframeCaptureRunner(): string {
  return `import {chromium} from ${resolvePlaywrightModuleSpecifier()};
import {readFile, stat} from 'node:fs/promises';

const manifestPath = process.argv.at(-1);

if (manifestPath === undefined) {
  throw new Error('Missing Playwright keyframe capture manifest path.');
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const browser = await chromium.launch({headless: true});

try {
  const context = await browser.newContext({
    viewport: {
      width: manifest.viewport.width,
      height: manifest.viewport.height,
    },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  for (const frame of manifest.frames) {
    await page.goto(frame.url, {waitUntil: 'networkidle'});
    await page.screenshot({
      path: frame.path,
      fullPage: false,
    });

    const info = await stat(frame.path);
    if (info.size <= 0) {
      throw new Error(\`Empty keyframe screenshot: \${frame.path}\`);
    }
  }

  await context.close();
} finally {
  await browser.close();
}
`
}

function createPlaywrightFrameSequenceCaptureRunner(): string {
  return `import {chromium} from ${resolvePlaywrightModuleSpecifier()};
import {readFile, stat} from 'node:fs/promises';

const manifestPath = process.argv.at(-1);

if (manifestPath === undefined) {
  throw new Error('Missing Playwright frame sequence capture manifest path.');
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const browser = await chromium.launch({headless: true});

try {
  const context = await browser.newContext({
    viewport: {
      width: manifest.viewport.width,
      height: manifest.viewport.height,
    },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  for (const frame of manifest.frames) {
    await page.goto(frame.url, {waitUntil: 'networkidle'});
    await page.screenshot({
      path: frame.path,
      fullPage: false,
    });

    const info = await stat(frame.path);
    if (info.size <= 0) {
      throw new Error(\`Empty frame screenshot: \${frame.path}\`);
    }
  }

  await context.close();
} finally {
  await browser.close();
}
`
}

function resolvePlaywrightModuleSpecifier(): string {
  const resolver = (import.meta as ImportMeta & {resolve?: (specifier: string) => string}).resolve

  return JSON.stringify(resolver?.call(import.meta, 'playwright') ?? 'playwright')
}

async function assertPlaywrightFrameOutputs(frames: DeckHtmlFrameSequenceFrame[], command: string[], stderr: string): Promise<void> {
  await Promise.all(frames.map(async (frame) => {
    const info = await stat(frame.path)

    if (info.size <= 0) {
      throw new PlaywrightCaptureError('Playwright frame screenshot output is empty.', command, stderr)
    }
  }))
}

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

function slideIdAtTime(timedDeck: TimedDeck, time: number): string {
  const timing = timedDeck.timings.find((item, index) => {
    const isLast = index === timedDeck.timings.length - 1

    return time >= item.start && (time < item.end || isLast)
  })

  return timing?.slideId ?? timedDeck.deck.slides[0]?.slideId ?? 'slide-001'
}

async function runConcurrent<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
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

function normalizeCaptureConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 1
  }

  return Math.max(1, Math.floor(value))
}

function normalizeFrameRange(input: {end: number | undefined; frameCount: number; start: number | undefined}): {end: number; start: number} {
  const start = input.start === undefined || !Number.isFinite(input.start) ? 1 : Math.max(1, Math.floor(input.start))
  const end = input.end === undefined || !Number.isFinite(input.end) ? input.frameCount : Math.min(input.frameCount, Math.max(1, Math.floor(input.end)))

  if (end < start) {
    throw new RangeError(`Frame range end (${end}) must be greater than or equal to start (${start}).`)
  }

  return {end, start}
}

async function isNonEmptyFile(path: string): Promise<boolean> {
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
