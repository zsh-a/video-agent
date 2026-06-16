import type {Deck, Slide, SlideTiming, TimedDeck} from '@video-agent/ir'

import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'

import {bunWrite} from './bun-runtime.js'

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

function createDeckHtml(plan: DeckHtmlRenderPlan): string {
  const timingBySlide = new Map(plan.timings.map((timing) => [timing.slideId, timing]))
  const slides = plan.deck.slides.map((slide, index) => createSlideSection(slide, timingBySlide.get(slide.slideId), index)).join('\n')

  return `<!doctype html>
<html lang="${escapeHtml(plan.deck.language)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(plan.deck.title)}</title>
  <link rel="stylesheet" href="./styles.css" />
  <script type="application/json" id="deck-render-plan">${escapeHtml(JSON.stringify(plan))}</script>
</head>
<body data-format="${escapeHtml(plan.deck.format)}" data-theme="${escapeHtml(plan.deck.theme)}">
  <main class="deck" data-duration="${plan.duration}">
${slides}
  </main>
  <script type="module" src="./runtime.js"></script>
</body>
</html>
`
}

function createSlideSection(slide: Slide, timing: SlideTiming | undefined, index: number): string {
  const start = timing?.start ?? 0
  const duration = timing === undefined ? slide.duration ?? 0 : timing.end - timing.start
  const bullets = slide.bullets.length === 0 ? [] : slide.bullets
  const evidence = slide.evidence.map((item) => item.text ?? item.ref).filter(Boolean)

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
${evidence.length === 0 ? '' : `      <aside class="slide__evidence">
        <span>Evidence</span>
        <p>${escapeHtml(evidence.slice(0, 2).join(' '))}</p>
      </aside>`}
    </section>`
}

function createDeckStyles(deck: Deck): string {
  const aspectRatio = deck.format === 'landscape_1920x1080' ? '16 / 9' : deck.format === 'square_1080x1080' ? '1 / 1' : '9 / 16'

  return `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  background: #e7edf3;
  color: #101827;
  margin: 0;
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
.slide__note,
.slide__evidence p {
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

.slide__evidence {
  color: #475569;
  display: grid;
  gap: 8px;
}

.slide__evidence span {
  color: #f97316;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
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
  .slide__note,
  .slide__evidence p {
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

window.videoAgentDeck = {
  plan,
  seek(timeSeconds) {
    const slides = Array.from(document.querySelectorAll('.slide'))
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
