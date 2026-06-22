import type {TimedDeck} from '@video-agent/ir'
import type {
  CaptureDeckHtmlFrameSequenceOptions,
  CaptureDeckHtmlFrameSequenceResult,
  CaptureDeckHtmlKeyframesOptions,
  CaptureDeckHtmlKeyframesResult,
  DeckHtmlFrameSequenceFrame,
  DeckHtmlKeyframe,
  PlaywrightFrameSequenceCaptureManifest,
  PlaywrightKeyframeCaptureManifest,
} from './types.js'

import {runProcess} from '@video-agent/media'
import {deckCanvasSize, writeDeckHtmlCapturePage} from '@video-agent/renderer-deck'
import {mkdir, stat, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

import {createDeckHtmlFrameSequence, createDeckHtmlKeyframes} from './planning.js'
import {isNonEmptyFile, normalizeCaptureConcurrency, normalizeFrameRange, requireCaptureFps} from './utils.js'

export class PlaywrightCaptureError extends Error {
  constructor(
    message: string,
    readonly command: string[],
    readonly stderr: string,
  ) {
    super(formatCaptureErrorMessage(message, stderr))
  }
}

export async function captureDeckHtmlFrameSequenceWithPlaywright(options: CaptureDeckHtmlFrameSequenceOptions): Promise<CaptureDeckHtmlFrameSequenceResult> {
  const outputDir = resolve(options.outputDir)
  const projectDir = resolve(options.projectDir)
  const captureDir = resolve(projectDir, 'capture-sequence-playwright')
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

export async function captureDeckHtmlKeyframesWithPlaywright(options: CaptureDeckHtmlKeyframesOptions): Promise<CaptureDeckHtmlKeyframesResult> {
  const outputDir = resolve(options.outputDir)
  const projectDir = resolve(options.projectDir)
  const captureDir = resolve(projectDir, 'capture-keyframes-playwright')
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

function formatCaptureErrorMessage(message: string, stderr: string): string {
  const detail = stderr.trim()

  if (detail === '') {
    return message
  }

  return `${message}: ${detail}`
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
