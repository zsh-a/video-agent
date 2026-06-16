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
  const isProcess = slide.type === 'process'
  const isQuote = slide.type === 'quote'
  const isCode = slide.type === 'code'
  const listTag = isProcess ? 'ol' : 'ul'
  const bulletItems = bullets.map((bullet) => {
    const content = escapeHtml(bullet)
    return isQuote ? `          <li><span class="quote-mark">“</span>${content}</li>` : `          <li>${content}</li>`
  }).join('\n')
  const bulletsHtml = bullets.length === 0 ? '' : `        <${listTag} class="slide__bullets">
${bulletItems}
        </${listTag}>`
  const codeBlock = isCode && bullets.length > 0 ? `        <div class="slide__code-block">
          <pre><code>${bullets.map((b) => escapeHtml(b)).join('\n')}</code></pre>
        </div>` : ''
  const visualArea = slide.visual?.kind === 'image' || slide.visual?.kind === 'diagram'
    ? `        <div class="slide__visual-area">
          <span class="slide__visual-icon">${slide.visual.kind === 'image' ? '🖼️' : '📊'}</span>
        </div>`
    : ''

  return `    <section class="slide slide--${escapeHtml(slide.type)}" data-slide="${escapeHtml(slide.slideId)}" data-start="${start}" data-duration="${round(duration)}">
      <div class="slide__chrome">
        <span class="slide__count">${String(index + 1).padStart(2, '0')}</span>
        <span class="slide__kind">${escapeHtml(formatSlideType(slide.type))}</span>
      </div>
      <div class="slide__content">
${visualArea}        <header class="slide__header">
          <h1>${escapeHtml(slide.title)}</h1>
${slide.subtitle === undefined ? '' : `          <p class="slide__subtitle">${escapeHtml(slide.subtitle)}</p>`}
        </header>
${isCode ? codeBlock : bulletsHtml}
${slide.speakerNote === undefined ? '' : `        <p class="slide__note">${escapeHtml(slide.speakerNote)}</p>`}
      </div>
    </section>`
}

// ---------------------------------------------------------------------------
// CSS generation — modular architecture
// ---------------------------------------------------------------------------

function createDeckStyles(deck: Deck): string {
  return [
    cssThemeTokens(deck.format),
    cssBaseStyles(),
    cssSlideCore(),
    cssSlideContent(),
    cssSlideTypeVariants(),
    cssAnimations(),
    cssResponsive(),
    cssCaptureMode(),
  ].join('\n')
}

// --- Theme tokens (CSS custom properties) ---------------------------------

function cssThemeTokens(format: Deck['format']): string {
  const aspectRatio = format === 'landscape_1920x1080' ? '16 / 9' : format === 'square_1080x1080' ? '1 / 1' : '9 / 16'

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

  --aspect-ratio: ${aspectRatio};

  /* surface */
  --bg-page: #e7edf3;
  --bg-card: #fbfcfe;
  --bg-card-alt: #f1f5f9;
  --bg-card-highlight: #eff6ff;

  /* text */
  --text-primary: #0f172a;
  --text-secondary: #334155;
  --text-body: #1f2937;
  --text-chrome: #2563eb;

  /* accent */
  --accent-primary: #2563eb;
  --accent-secondary: #0f766e;
  --accent-warm: #f97316;

  /* border */
  --border: #c9d5e3;
  --border-light: #d8e1ed;

  /* gradient */
  --gradient-bar: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary) 52%, var(--accent-warm));

  /* spacing */
  --slide-padding: clamp(28px, 5%, 64px);
  --slide-width: ${format === 'portrait_1080x1920' ? '560px' : '1180px'};

  /* typography */
  --font-size-h1: 44px;
  --font-size-subtitle: 20px;
  --font-size-body: 24px;
  --font-size-chrome: 12px;
  --font-size-small: 13px;
  --line-height-h1: 1.15;
  --line-height-body: 1.4;
  --letter-spacing-h1: 0.01em;
}

body[data-theme="dark"] {
  --bg-page: #0f172a;
  --bg-card: #1e293b;
  --bg-card-alt: #293548;
  --bg-card-highlight: #1e3a5f;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-body: #cbd5e1;
  --text-chrome: #60a5fa;
  --accent-primary: #3b82f6;
  --accent-secondary: #14b8a6;
  --accent-warm: #fb923c;
  --border: #334155;
  --border-light: #475569;
}
`
}

// --- Base styles (body, deck container) -----------------------------------

function cssBaseStyles(): string {
  return `
body {
  background: var(--bg-page);
  color: var(--text-primary);
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
`
}

// --- Slide core (shared by all types) -------------------------------------

function cssSlideCore(): string {
  return `
.slide {
  aspect-ratio: var(--aspect-ratio);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 18px 54px rgb(14 24 38 / 14%);
  box-sizing: border-box;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  padding: var(--slide-padding);
  position: relative;
  width: min(100%, var(--slide-width));
}

.slide::before {
  background: var(--gradient-bar);
  content: "";
  height: 8px;
  left: 0;
  position: absolute;
  right: 0;
  top: 0;
}
`
}

// --- Slide content elements (chrome, header, bullets, note) ---------------

function cssSlideContent(): string {
  return `
/* chrome (slide number + type label) */
.slide__chrome {
  align-items: center;
  color: var(--text-chrome);
  display: flex;
  font-size: var(--font-size-chrome);
  font-weight: 700;
  justify-content: space-between;
  letter-spacing: 0.04em;
  opacity: 0.7;
  text-transform: uppercase;
}

/* content grid */
.slide__content {
  align-content: center;
  display: grid;
  gap: 22px;
  min-height: 0;
}

/* header */
.slide__header h1 {
  color: var(--text-primary);
  font-size: var(--font-size-h1);
  letter-spacing: var(--letter-spacing-h1);
  line-height: var(--line-height-h1);
  margin: 0;
  text-wrap: balance;
}

.slide__subtitle,
.slide__note {
  color: var(--text-secondary);
  font-size: var(--font-size-subtitle);
  line-height: 1.42;
  margin: 0;
}

/* bullets */
.slide__bullets {
  display: grid;
  gap: 14px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.slide__bullets li {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-left: 6px solid var(--accent-secondary);
  border-radius: 8px;
  color: var(--text-body);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
  padding: 12px 16px;
}

/* note */
.slide__note {
  border-top: 1px solid var(--border-light);
  padding-top: 16px;
}
`
}

// --- Slide type variants --------------------------------------------------

function cssSlideTypeVariants(): string {
  return `
/* ---- title ---- */
.slide--title .slide__content {
  align-content: center;
  text-align: center;
}

.slide--title .slide__header h1 {
  font-size: clamp(36px, 6vw, 56px);
  background: var(--gradient-bar);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  padding-bottom: 4px;
}

/* ---- quote ---- */
.slide--quote .slide__bullets li {
  border-left: 4px solid var(--accent-primary);
  background: var(--bg-card-highlight);
  font-style: italic;
  position: relative;
  padding-left: 32px;
}

.slide--quote .quote-mark {
  color: var(--accent-primary);
  font-size: 2em;
  font-style: normal;
  font-weight: 700;
  line-height: 1;
  opacity: 0.3;
  position: absolute;
  left: 10px;
  top: 8px;
}

/* ---- process ---- */
.slide--process .slide__bullets {
  counter-reset: step;
}

.slide--process .slide__bullets li {
  border-left: none;
  counter-increment: step;
  padding-left: 52px;
  position: relative;
}

.slide--process .slide__bullets li::before {
  align-items: center;
  background: var(--accent-primary);
  border-radius: 50%;
  color: #ffffff;
  content: counter(step);
  display: flex;
  font-size: 14px;
  font-weight: 700;
  height: 32px;
  justify-content: center;
  left: 8px;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
}

/* ---- timeline ---- */
.slide--timeline .slide__bullets {
  border-left: 3px solid var(--border-light);
  gap: 20px;
  margin-left: 12px;
  padding-left: 28px;
}

.slide--timeline .slide__bullets li {
  border-left: none;
  position: relative;
}

.slide--timeline .slide__bullets li::before {
  background: var(--accent-secondary);
  border: 3px solid var(--bg-card);
  border-radius: 50%;
  content: "";
  height: 14px;
  left: -37px;
  position: absolute;
  top: 12px;
  width: 14px;
}

/* ---- compare ---- */
.slide--compare .slide__bullets {
  grid-template-columns: 1fr 1fr;
}

.slide--compare .slide__bullets li:first-child {
  border-left-color: var(--accent-primary);
}

.slide--compare .slide__bullets li:last-child {
  border-left-color: var(--accent-warm);
}

/* ---- code ---- */
.slide--code .slide__content {
  gap: 16px;
}

.slide--code .slide__code-block {
  background: #1e293b;
  border-radius: 8px;
  overflow: auto;
  padding: 20px;
}

.slide--code .slide__code-block pre {
  margin: 0;
}

.slide--code .slide__code-block code {
  color: #e2e8f0;
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, "SF Mono", monospace;
  font-size: 16px;
  line-height: 1.6;
  white-space: pre;
}

body[data-theme="dark"] .slide--code .slide__code-block {
  background: #0f172a;
  border: 1px solid var(--border);
}

/* ---- section ---- */
.slide--section {
  background: var(--bg-card-alt);
}

.slide--section .slide__content {
  align-content: center;
  text-align: center;
}

.slide--section .slide__header h1 {
  font-size: clamp(32px, 5vw, 48px);
}

/* ---- summary ---- */
.slide--summary {
  background: var(--bg-card-highlight);
}

.slide--summary .slide__bullets li {
  border-left-color: var(--accent-primary);
}

/* ---- cta ---- */
.slide--cta .slide__content {
  align-content: center;
  text-align: center;
}

.slide--cta .slide__header h1 {
  font-size: clamp(28px, 4.5vw, 44px);
}

/* ---- chart / image ---- */
.slide--chart .slide__content,
.slide--image .slide__content {
  gap: 16px;
}

.slide__visual-area {
  align-items: center;
  background: var(--bg-card-alt);
  border: 1px dashed var(--border-light);
  border-radius: 8px;
  display: flex;
  justify-content: center;
  min-height: 160px;
}

.slide__visual-icon {
  font-size: 48px;
  opacity: 0.4;
}
`
}

// --- CSS animations -------------------------------------------------------

function cssAnimations(): string {
  return `
@keyframes fadeSlideUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.slide__header {
  animation: fadeSlideUp 0.4s ease-out both;
}

.slide__bullets li:nth-child(1) { animation: fadeSlideUp 0.4s ease-out 0.15s both; }
.slide__bullets li:nth-child(2) { animation: fadeSlideUp 0.4s ease-out 0.25s both; }
.slide__bullets li:nth-child(3) { animation: fadeSlideUp 0.4s ease-out 0.35s both; }
.slide__bullets li:nth-child(4) { animation: fadeSlideUp 0.4s ease-out 0.45s both; }
.slide__bullets li:nth-child(5) { animation: fadeSlideUp 0.4s ease-out 0.55s both; }
.slide__bullets li:nth-child(6) { animation: fadeSlideUp 0.4s ease-out 0.65s both; }

.slide__note {
  animation: fadeSlideUp 0.4s ease-out 0.5s both;
}

.slide__visual-area {
  animation: fadeSlideUp 0.4s ease-out 0.1s both;
}
`
}

// --- Responsive -----------------------------------------------------------

function cssResponsive(): string {
  return `
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

@media (max-width: 700px) {
  :root {
    --font-size-h1: 30px;
    --font-size-subtitle: 16px;
    --font-size-body: 17px;
    --slide-padding: 28px;
  }

  .deck {
    padding: 16px;
  }

  .slide--compare .slide__bullets {
    grid-template-columns: 1fr;
  }

  .slide--title .slide__header h1 {
    font-size: 28px;
  }
}
`
}

// --- Capture mode ---------------------------------------------------------

function cssCaptureMode(): string {
  return `
body[data-capture="slide"] {
  background: var(--bg-page);
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

body[data-capture="slide"] .slide__chrome {
  display: none;
}
`
}

// --- Runtime script -------------------------------------------------------

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

// --- Helpers --------------------------------------------------------------

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
