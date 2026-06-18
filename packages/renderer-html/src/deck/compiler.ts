import type {Deck, SlideTiming, TimedDeck} from '@video-agent/ir'

import {copyFile, mkdir} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname, resolve} from 'node:path'

import {bunWrite} from '../bun-runtime.js'
import {deckCanvasSize} from './format.js'
import {compileDeckMotionPlan, type DeckMotionPlan} from './motion.js'
import {createDeckRuntimeScript} from './runtime.js'
import {compileDeckTailwindCss} from './tailwind.js'
import {renderDeckStage} from './templates.js'

const require = createRequire(import.meta.url)
const DECK_FONT_FILES = [
  'noto-sans-sc-chinese-simplified-400-normal.woff2',
  'noto-sans-sc-chinese-simplified-700-normal.woff2',
]

export interface DeckHtmlRenderPlan {
  audioRef?: string
  canvas: {
    height: number
    width: number
  }
  deck: Deck
  duration: number
  entryHtml: string
  motion: DeckMotionPlan
  outputDir: string
  runtimePath: string
  stylesPath: string
  timings: SlideTiming[]
  version: 2
}

export interface WriteDeckHtmlProjectInput {
  outputDir: string
  timedDeck: TimedDeck
}

export interface WriteDeckHtmlProjectResult {
  entryHtml: string
  outputDir: string
  planPath: string
  runtimePath: string
  stylesPath: string
}

export interface WriteDeckHtmlCapturePageInput {
  outputPath: string
  runtimeHref: string
  slideId: string
  stylesheetHref: string
  timedDeck: TimedDeck
}

export async function writeDeckHtmlProject(input: WriteDeckHtmlProjectInput): Promise<WriteDeckHtmlProjectResult> {
  const outputDir = resolve(input.outputDir)
  const entryHtml = resolve(outputDir, 'index.html')
  const planPath = resolve(outputDir, 'deck-render-plan.json')
  const runtimePath = resolve(outputDir, 'runtime.js')
  const stylesPath = resolve(outputDir, 'styles.css')
  const tailwindInputPath = resolve(outputDir, 'tailwind.css')
  const plan = createDeckHtmlRenderPlan({
    entryHtml,
    outputDir,
    runtimePath,
    stylesPath,
    timedDeck: input.timedDeck,
  })

  await mkdir(outputDir, {recursive: true})
  await writeDeckFontAssets(outputDir)
  await bunWrite(planPath, `${JSON.stringify(plan, null, 2)}\n`)
  await bunWrite(runtimePath, createDeckRuntimeScript())
  await bunWrite(entryHtml, createDeckHtml(plan, {
    runtimeHref: './runtime.js',
    stylesheetHref: './styles.css',
  }))
  await compileDeckTailwindCss({
    deck: input.timedDeck.deck,
    inputPath: tailwindInputPath,
    outputPath: stylesPath,
    sourceHtmlPath: entryHtml,
  })

  return {
    entryHtml,
    outputDir,
    planPath,
    runtimePath,
    stylesPath,
  }
}

export async function writeDeckHtmlCapturePage(input: WriteDeckHtmlCapturePageInput): Promise<string> {
  const outputPath = resolve(input.outputPath)
  const outputDir = dirname(outputPath)
  const plan = createDeckHtmlRenderPlan({
    entryHtml: outputPath,
    outputDir,
    runtimePath: resolve(outputDir, input.runtimeHref),
    stylesPath: resolve(outputDir, input.stylesheetHref),
    timedDeck: input.timedDeck,
  })

  await mkdir(outputDir, {recursive: true})
  await bunWrite(outputPath, createDeckHtml(plan, {
    captureSlideId: input.slideId,
    runtimeHref: input.runtimeHref,
    stylesheetHref: input.stylesheetHref,
  }))

  return outputPath
}

function createDeckHtmlRenderPlan(input: {
  entryHtml: string
  outputDir: string
  runtimePath: string
  stylesPath: string
  timedDeck: TimedDeck
}): DeckHtmlRenderPlan {
  const motion = compileDeckMotionPlan(input.timedDeck)

  return {
    ...(input.timedDeck.audioRef === undefined ? {} : {audioRef: input.timedDeck.audioRef}),
    canvas: deckCanvasSize(input.timedDeck.deck.format),
    deck: input.timedDeck.deck,
    duration: motion.duration,
    entryHtml: input.entryHtml,
    motion,
    outputDir: input.outputDir,
    runtimePath: input.runtimePath,
    stylesPath: input.stylesPath,
    timings: input.timedDeck.timings,
    version: 2,
  }
}

interface CreateDeckHtmlOptions {
  captureSlideId?: string
  runtimeHref: string
  stylesheetHref: string
}

function createDeckHtml(plan: DeckHtmlRenderPlan, options: CreateDeckHtmlOptions): string {
  return `<!doctype html>
<html lang="${escapeHtml(plan.deck.language)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${plan.canvas.width}, initial-scale=1" />
  <title>${escapeHtml(plan.deck.title)}</title>
  <link rel="stylesheet" href="${escapeHtml(options.stylesheetHref)}" />
  <script type="application/json" id="deck-render-plan">${serializeJsonForScript(plan)}</script>
</head>
<body data-format="${escapeHtml(plan.deck.format)}" data-theme="${escapeHtml(plan.deck.theme)}"${options.captureSlideId === undefined ? '' : ' data-capture="slide"'}>
${renderDeckStage(plan.deck, {
  captureSlideId: options.captureSlideId,
  timings: plan.timings,
})}
  <script type="module" src="${escapeHtml(options.runtimeHref)}"></script>
</body>
</html>
`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function serializeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

async function writeDeckFontAssets(outputDir: string): Promise<void> {
  const fontsDir = resolve(outputDir, 'fonts')

  await mkdir(fontsDir, {recursive: true})
  await Promise.all(DECK_FONT_FILES.map((file) => copyFile(resolveDeckFontSource(file), resolve(fontsDir, file))))
}

function resolveDeckFontSource(file: string): string {
  return require.resolve(`@fontsource/noto-sans-sc/files/${file}`)
}
