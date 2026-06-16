import type {Deck, Slide, SlideTiming, TimedDeck} from '@video-agent/ir'

import {copyFile, mkdir} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname, resolve} from 'node:path'

import {bunWrite} from './bun-runtime.js'

const require = createRequire(import.meta.url)
const DECK_FONT_FILES = [
  'noto-sans-sc-chinese-simplified-400-normal.woff2',
  'noto-sans-sc-chinese-simplified-700-normal.woff2',
]

export interface DeckHtmlRenderPlan {
  audioRef?: string
  deck: Deck
  duration: number
  entryHtml: string
  outputDir: string
  runtimePath: string
  stylesPath: string
  timings: SlideTiming[]
  version: 1
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
  const plan = createDeckHtmlRenderPlan({
    entryHtml,
    outputDir,
    planPath,
    runtimePath,
    stylesPath,
    timedDeck: input.timedDeck,
  })

  await mkdir(outputDir, {recursive: true})
  await writeDeckFontAssets(outputDir)
  await bunWrite(planPath, `${JSON.stringify(plan, null, 2)}\n`)
  await bunWrite(stylesPath, createDeckStyles(input.timedDeck.deck))
  await bunWrite(runtimePath, createRuntimeScript())
  await bunWrite(entryHtml, createDeckHtml(plan))

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
    planPath: resolve(outputDir, 'deck-render-plan.json'),
    runtimePath: resolve(outputDir, 'runtime.js'),
    stylesPath: resolve(outputDir, input.stylesheetHref),
    timedDeck: input.timedDeck,
  })

  await mkdir(outputDir, {recursive: true})
  await bunWrite(outputPath, createDeckHtml(plan, {
    captureSlideId: input.slideId,
    includeRenderPlan: false,
    includeRuntime: false,
    stylesheetHref: input.stylesheetHref,
  }))

  return outputPath
}

function createDeckHtmlRenderPlan(input: {
  entryHtml: string
  outputDir: string
  planPath: string
  runtimePath: string
  stylesPath: string
  timedDeck: TimedDeck
}): DeckHtmlRenderPlan {
  return {
    ...(input.timedDeck.audioRef === undefined ? {} : {audioRef: input.timedDeck.audioRef}),
    deck: input.timedDeck.deck,
    duration: input.timedDeck.timings.at(-1)?.end ?? 0,
    entryHtml: input.entryHtml,
    outputDir: input.outputDir,
    runtimePath: input.runtimePath,
    stylesPath: input.stylesPath,
    timings: input.timedDeck.timings,
    version: 1,
  }
}

interface CreateDeckHtmlOptions {
  captureSlideId?: string
  includeRenderPlan?: boolean
  includeRuntime?: boolean
  stylesheetHref?: string
}

function createDeckHtml(plan: DeckHtmlRenderPlan, options: CreateDeckHtmlOptions = {}): string {
  const timingBySlide = new Map(plan.timings.map((timing) => [timing.slideId, timing]))
  const sourceSlides = options.captureSlideId === undefined ? plan.deck.slides : plan.deck.slides.filter((slide) => slide.slideId === options.captureSlideId)
  const slides = sourceSlides.map((slide) => createSlideSection(slide, timingBySlide.get(slide.slideId), plan.deck.slides.findIndex((item) => item.slideId === slide.slideId))).join('\n')
  const includeRenderPlan = options.includeRenderPlan ?? true
  const includeRuntime = options.includeRuntime ?? true

  return `<!doctype html>
<html lang="${escapeHtml(plan.deck.language)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(plan.deck.title)}</title>
  <link rel="stylesheet" href="${escapeHtml(options.stylesheetHref ?? './styles.css')}" />
${includeRenderPlan ? `  <script type="application/json" id="deck-render-plan">${escapeHtml(JSON.stringify(plan))}</script>` : ''}
</head>
<body data-format="${escapeHtml(plan.deck.format)}" data-theme="${escapeHtml(plan.deck.theme)}"${options.captureSlideId === undefined ? '' : ' data-capture="slide"'}>
  <main class="deck" data-duration="${plan.duration}">
${slides}
  </main>
${includeRuntime ? '  <script type="module" src="./runtime.js"></script>' : ''}
</body>
</html>
`
}

function createSlideSection(slide: Slide, timing: SlideTiming | undefined, index: number): string {
  const start = timing?.start ?? 0
  const duration = timing === undefined ? slide.duration ?? 0 : timing.end - timing.start
  const bullets = slide.bullets.length === 0 ? [] : slide.bullets

  return `    <section class="slide slide--${escapeHtml(slide.type)}" data-slide="${escapeHtml(slide.slideId)}" data-start="${start}" data-duration="${round(duration)}">
      <div class="slide__chrome">
        <span class="slide__count">${String(index + 1).padStart(2, '0')}</span>
        <span class="slide__kind">${escapeHtml(formatSlideType(slide.type))}</span>
      </div>
      <div class="slide__content">
        <header class="slide__header">
          <h1>${escapeHtml(slide.title)}</h1>
${slide.subtitle === undefined ? '' : `          <p class="slide__subtitle">${escapeHtml(slide.subtitle)}</p>`}
        </header>
${bullets.length === 0 ? '' : `        <ul class="slide__bullets">
${bullets.map((bullet) => `          <li>${escapeHtml(bullet)}</li>`).join('\n')}
        </ul>`}
${slide.speakerNote === undefined ? '' : `        <p class="slide__note">${escapeHtml(slide.speakerNote)}</p>`}
      </div>
    </section>`
}

function createDeckStyles(deck: Deck): string {
  const aspectRatio = deck.format === 'landscape_1920x1080' ? '16 / 9' : deck.format === 'square_1080x1080' ? '1 / 1' : '9 / 16'

  return `@font-face {
  font-display: swap;
  font-family: "Noto Sans SC";
  font-style: normal;
  font-weight: 400;
  src: url("./fonts/noto-sans-sc-chinese-simplified-400-normal.woff2") format("woff2");
}

@font-face {
  font-display: swap;
  font-family: "Noto Sans SC";
  font-style: normal;
  font-weight: 700;
  src: url("./fonts/noto-sans-sc-chinese-simplified-700-normal.woff2") format("woff2");
}

:root {
  color-scheme: light;
  font-family: "Noto Sans SC", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  background: #e7edf3;
  color: #101827;
  margin: 0;
}

[hidden] {
  display: none !important;
}

.deck {
  align-items: center;
  box-sizing: border-box;
  display: grid;
  gap: 32px;
  justify-items: center;
  min-height: 100vh;
  padding: 32px;
}

.slide {
  aspect-ratio: ${aspectRatio};
  background: #fbfcfe;
  border: 1px solid #c9d5e3;
  border-radius: 8px;
  box-shadow: 0 18px 54px rgb(14 24 38 / 14%);
  box-sizing: border-box;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  padding: clamp(28px, 5%, 64px);
  position: relative;
  width: min(100%, ${deck.format === 'portrait_1080x1920' ? '560px' : '1180px'});
}

.slide::before {
  background: linear-gradient(90deg, #2563eb, #0f766e 52%, #f97316);
  content: "";
  height: 8px;
  left: 0;
  position: absolute;
  right: 0;
  top: 0;
}

.slide__chrome {
  align-items: center;
  color: #2563eb;
  display: flex;
  font-size: 13px;
  font-weight: 700;
  justify-content: space-between;
  letter-spacing: 0;
  text-transform: uppercase;
}

.slide__content {
  align-content: center;
  display: grid;
  gap: 22px;
  min-height: 0;
}

.slide__header h1 {
  color: #0f172a;
  font-size: 44px;
  letter-spacing: 0;
  line-height: 1.08;
  margin: 0;
}

.slide__subtitle,
.slide__note {
  color: #334155;
  font-size: 20px;
  line-height: 1.42;
  margin: 0;
}

.slide__bullets {
  display: grid;
  gap: 14px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.slide__bullets li {
  background: #ffffff;
  border: 1px solid #d8e1ed;
  border-left: 6px solid #0f766e;
  border-radius: 8px;
  color: #1f2937;
  font-size: 24px;
  line-height: 1.34;
  padding: 12px 16px;
}

.slide__note {
  border-top: 1px solid #d8e1ed;
  padding-top: 16px;
}

@media print {
  body {
    background: #ffffff;
  }

  .deck {
    display: block;
    padding: 0;
  }

  .slide {
    box-shadow: none;
    break-after: page;
    margin: 0 auto;
    width: 100%;
  }
}

body[data-capture="slide"] {
  background: #e7edf3;
  height: 100vh;
  overflow: hidden;
  width: 100vw;
}

body[data-capture="slide"] .deck {
  align-items: stretch;
  display: grid;
  gap: 0;
  justify-items: stretch;
  min-height: 100vh;
  padding: 0;
}

body[data-capture="slide"] .slide {
  border: 0;
  border-radius: 0;
  box-shadow: none;
  height: 100vh;
  width: 100vw;
}

@media (max-width: 700px) {
  .deck {
    padding: 16px;
  }

  .slide {
    padding: 28px;
  }

  .slide__header h1 {
    font-size: 30px;
  }

  .slide__subtitle,
  .slide__note {
    font-size: 16px;
  }

  .slide__bullets li {
    font-size: 17px;
  }
}
`
}

function createRuntimeScript(): string {
  return `const planElement = document.getElementById('deck-render-plan')
const plan = planElement === null ? undefined : JSON.parse(planElement.textContent || '{}')
const url = new URL(window.location.href)
const captureMode = url.searchParams.get('capture')
const requestedSlide = url.searchParams.get('slide')
const slides = Array.from(document.querySelectorAll('.slide'))

if (captureMode === 'slide') {
  document.body.dataset.capture = 'slide'
}

if (requestedSlide !== null) {
  for (const slide of slides) {
    slide.hidden = slide.getAttribute('data-slide') !== requestedSlide
  }
}

window.videoAgentDeck = {
  plan,
  seek(timeSeconds) {
    for (const slide of slides) {
      const start = Number(slide.getAttribute('data-start') || 0)
      const duration = Number(slide.getAttribute('data-duration') || 0)
      slide.toggleAttribute('data-active', timeSeconds >= start && timeSeconds < start + duration)
    }
  },
}
`
}

function formatSlideType(type: Slide['type']): string {
  return type.replaceAll('_', ' ')
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function writeDeckFontAssets(outputDir: string): Promise<void> {
  const fontsDir = resolve(outputDir, 'fonts')

  await mkdir(fontsDir, {recursive: true})
  await Promise.all(DECK_FONT_FILES.map((file) => copyFile(resolveDeckFontSource(file), resolve(fontsDir, file))))
}

function resolveDeckFontSource(file: string): string {
  return require.resolve(`@fontsource/noto-sans-sc/files/${file}`)
}
