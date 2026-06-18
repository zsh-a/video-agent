import type {Deck} from '@video-agent/ir'

import {deckCanvasSize} from '../format.js'

export interface CreateDeckThemeCssOptions {
  sourceHtmlPath: string
  tailwindCssPath: string
}

const THEME_TOKEN_KEYS = [
  'bg',
  'bg-2',
  'surface',
  'surface-strong',
  'surface-soft',
  'fg',
  'muted',
  'line',
  'line-soft',
  'accent',
  'accent-2',
  'accent-warm',
  'shadow',
] as const

interface ThemeTokenSet {
  colorScheme?: 'light'
  name: string
  values: readonly string[]
}

const THEME_TOKEN_SETS: readonly ThemeTokenSet[] = [
  {
    name: 'elegant-dark',
    values: ['#080b12', '#111827', 'rgb(244 248 255 / 8%)', 'rgb(244 248 255 / 14%)', 'rgb(15 23 42 / 72%)', '#f7fafc', '#aeb9c8', 'rgb(217 226 239 / 22%)', 'rgb(217 226 239 / 10%)', '#56d6ff', '#58e6a9', '#f6c96b', 'rgb(0 0 0 / 34%)'],
  },
  {
    colorScheme: 'light',
    name: 'clean-white',
    values: ['#f7f8f5', '#e9eee9', 'rgb(10 16 24 / 5%)', 'rgb(10 16 24 / 9%)', 'rgb(255 255 255 / 82%)', '#121619', '#5b6670', 'rgb(18 22 25 / 16%)', 'rgb(18 22 25 / 8%)', '#0b7f72', '#2563eb', '#b45309', 'rgb(16 24 40 / 12%)'],
  },
  {
    name: 'finance-terminal',
    values: ['#07100f', '#111b1d', 'rgb(237 248 244 / 8%)', 'rgb(237 248 244 / 15%)', 'rgb(9 28 27 / 74%)', '#f4fff9', '#a7bbb3', 'rgb(196 231 218 / 20%)', 'rgb(196 231 218 / 9%)', '#43e59b', '#4cc9f0', '#f2c15d', 'rgb(0 0 0 / 36%)'],
  },
  {
    name: 'tech-gradient',
    values: ['#071019', '#101827', 'rgb(226 240 255 / 8%)', 'rgb(226 240 255 / 15%)', 'rgb(15 24 38 / 78%)', '#f8fbff', '#a8b8c9', 'rgb(213 233 255 / 20%)', 'rgb(213 233 255 / 9%)', '#31d8ff', '#b8ec5b', '#fb8b96', 'rgb(0 0 0 / 34%)'],
  },
  {
    colorScheme: 'light',
    name: 'minimal-editorial',
    values: ['#f6f4ef', '#e9e4da', 'rgb(24 24 27 / 6%)', 'rgb(24 24 27 / 11%)', 'rgb(255 254 250 / 84%)', '#191a1d', '#64605a', 'rgb(54 50 45 / 18%)', 'rgb(54 50 45 / 8%)', '#1d4ed8', '#0f766e', '#b45309', 'rgb(30 41 59 / 12%)'],
  },
  {
    colorScheme: 'light',
    name: 'warm-paper',
    values: ['#fff7ed', '#f0e2cf', 'rgb(67 20 7 / 7%)', 'rgb(67 20 7 / 12%)', 'rgb(255 251 235 / 82%)', '#1c1917', '#72695f', 'rgb(120 113 108 / 20%)', 'rgb(120 113 108 / 9%)', '#0f766e', '#5b6ee1', '#d97706', 'rgb(67 20 7 / 12%)'],
  },
]

export function createDeckThemeCss(deck: Deck, options: CreateDeckThemeCssOptions): string {
  const canvas = deckCanvasSize(deck.format)

  return [
    tailwindDirectives(options),
    fontFaces(),
    `:root {
  color-scheme: dark;
  font-family: "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
  --canvas-w: ${canvas.width}px;
  --canvas-h: ${canvas.height}px;
  --safe-x: ${deck.format === 'portrait_1080x1920' ? '78px' : '118px'};
  --safe-top: ${deck.format === 'portrait_1080x1920' ? '96px' : '68px'};
  --safe-bottom: ${deck.format === 'portrait_1080x1920' ? '132px' : '74px'};
  --radius-md: 8px;
  --radius-card: var(--radius-md);
  --font-title: ${deck.format === 'portrait_1080x1920' ? '74px' : '76px'};
  --font-heading: ${deck.format === 'portrait_1080x1920' ? '52px' : '48px'};
  --font-body: ${deck.format === 'portrait_1080x1920' ? '31px' : '28px'};
  --font-caption: ${deck.format === 'portrait_1080x1920' ? '22px' : '20px'};
  --line-title: 1.08;
  --line-body: 1.38;
  --shadow-card: 0 24px 80px var(--shadow);
}`,
    themeTokens(),
    baseCss(),
    templateCss(),
    captureCss(),
  ].join('\n\n')
}

function tailwindDirectives(options: CreateDeckThemeCssOptions): string {
  return `@import "${escapeCssString(options.tailwindCssPath)}";
@source "${escapeCssString(options.sourceHtmlPath)}";

@theme inline {
  --color-deck-bg: var(--bg);
  --color-deck-surface: var(--surface);
  --color-deck-surface-strong: var(--surface-strong);
  --color-deck-surface-soft: var(--surface-soft);
  --color-deck-fg: var(--fg);
  --color-deck-muted: var(--muted);
  --color-deck-line: var(--line);
  --color-deck-line-soft: var(--line-soft);
  --color-deck-accent: var(--accent);
  --color-deck-accent-2: var(--accent-2);
  --color-deck-accent-warm: var(--accent-warm);
  --font-sans: "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
  --text-deck-title: var(--font-title);
  --text-deck-heading: var(--font-heading);
  --text-deck-body: var(--font-body);
  --text-deck-caption: var(--font-caption);
  --leading-deck-title: var(--line-title);
  --leading-deck-body: var(--line-body);
  --radius-deck-card: var(--radius-card);
  --shadow-deck-card: var(--shadow-card);
}`
}

function fontFaces(): string {
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
}`
}

function themeTokens(): string {
  return THEME_TOKEN_SETS.map((theme) => {
    const declarations = theme.values
      .map((value, index) => `  --${THEME_TOKEN_KEYS[index]}: ${value};`)
      .join('\n')
    const colorScheme = theme.colorScheme === undefined ? '' : '  color-scheme: light;\n'

    return `body[data-theme="${theme.name}"] {
${colorScheme}${declarations}
}`
  }).join('\n\n')
}

function baseCss(): string {
  return `* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body {
  align-items: start;
  background: var(--bg);
  color: var(--fg);
  display: grid;
  justify-items: center;
  letter-spacing: 0;
  overflow: auto;
}

.stage {
  background:
    linear-gradient(118deg, color-mix(in srgb, var(--accent) 12%, transparent) 0%, transparent 34%),
    linear-gradient(242deg, color-mix(in srgb, var(--accent-2) 10%, transparent) 0%, transparent 38%),
    linear-gradient(180deg, color-mix(in srgb, var(--bg-2) 62%, var(--bg)), var(--bg) 72%),
    var(--bg);
  height: var(--canvas-h);
  isolation: isolate;
  overflow: hidden;
  position: relative;
  width: var(--canvas-w);
}

.stage::before {
  background-image:
    linear-gradient(var(--line-soft) 1px, transparent 1px),
    linear-gradient(90deg, var(--line-soft) 1px, transparent 1px),
    linear-gradient(135deg, transparent 0 48%, color-mix(in srgb, var(--accent-warm) 3%, transparent) 49% 51%, transparent 52% 100%);
  background-size: 72px 72px, 72px 72px, 620px 620px;
  content: "";
  inset: 0;
  mask-image: linear-gradient(180deg, transparent, #000 12%, #000 88%, transparent);
  opacity: 0.32;
  pointer-events: none;
  position: absolute;
  z-index: 0;
}

.stage::after {
  background:
    repeating-linear-gradient(0deg, rgb(255 255 255 / 3%) 0 1px, transparent 1px 5px),
    linear-gradient(90deg, rgb(255 255 255 / 7%), transparent 18%, transparent 82%, rgb(0 0 0 / 16%));
  content: "";
  inset: 0;
  opacity: 0.28;
  pointer-events: none;
  position: absolute;
  z-index: 0;
}

.slide {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: var(--canvas-h);
  inset: 0;
  opacity: 0;
  padding: var(--safe-top) var(--safe-x) var(--safe-bottom);
  pointer-events: none;
  position: absolute;
  transform-origin: center;
  will-change: opacity, transform, filter;
  width: var(--canvas-w);
  z-index: 1;
}

.slide::before {
  background: linear-gradient(180deg, var(--accent), var(--accent-2) 48%, var(--accent-warm));
  content: "";
  left: calc(var(--safe-x) - 34px);
  opacity: 0.58;
  position: absolute;
  top: var(--safe-top);
  bottom: var(--safe-bottom);
  width: 2px;
}

.slide[data-active="true"] {
  pointer-events: auto;
}

.safe-area {
  min-width: 0;
  width: 100%;
}

:where(.grid-primitive) {
  display: grid;
  min-width: 0;
}

:where(.stack) {
  display: grid;
  gap: var(--stack-gap, 18px);
  min-width: 0;
}

:where(.split) {
  display: grid;
  gap: var(--split-gap, 24px);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-width: 0;
}

:where(.center) {
  display: grid;
  min-width: 0;
  place-items: center;
}

:where(.card) {
  border-radius: var(--radius-card);
  min-width: 0;
}

:where(.background) {
  inset: 0;
  pointer-events: none;
  position: absolute;
}

.slide--dense .slide__content {
  gap: 26px;
}

.slide--dense .slide__title {
  font-size: calc(var(--font-heading) * 0.92);
}`
}

function templateCss(): string {
  return `.slide--hero .slide__content,
.slide--section .slide__content,
.slide--cta .slide__content {
  align-content: center;
}

.slide--hero .slide__content {
  gap: 42px;
}

.slide--hero .slide__title {
  background: linear-gradient(135deg, var(--fg) 0%, color-mix(in srgb, var(--accent) 74%, var(--fg)) 54%, color-mix(in srgb, var(--accent-warm) 54%, var(--fg)) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: var(--font-title);
  max-width: 11em;
}

.slide--section .slide__title {
  background: linear-gradient(90deg, var(--fg), color-mix(in srgb, var(--accent) 56%, var(--fg)));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero__points,
.points,
.summary__points {
  display: grid;
  gap: 18px;
}

body[data-format="landscape_1920x1080"] .hero__points {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.point,
.process-list li,
.idea-card,
.quote-block,
.stat-block,
.cta-block,
.code-block,
.comparison__side {
  background:
    linear-gradient(135deg, var(--surface-strong), var(--surface-soft)),
    var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  position: relative;
}

.point {
  align-items: start;
  display: grid;
  gap: 18px;
  grid-template-columns: auto 1fr;
  overflow: hidden;
  padding: 22px 26px;
  will-change: opacity, transform, filter;
}

.point::before {
  background: linear-gradient(180deg, var(--accent), var(--accent-2));
  content: "";
  inset: 0 auto 0 0;
  opacity: 0.82;
  position: absolute;
  width: 3px;
}

.point__index,
.process-list li span {
  color: var(--accent);
  font-size: var(--font-caption);
  font-weight: 700;
  line-height: 1.2;
}

.point p,
.process-list p,
.timeline__item p {
  color: var(--fg);
  font-size: var(--font-body);
  line-height: var(--line-body);
  margin: 0;
}

.slide--dense .point {
  padding: 19px 23px;
}

.slide--dense .point p,
.slide--dense .process-list p {
  font-size: calc(var(--font-body) * 0.84);
}

.summary__points .point__index {
  color: transparent;
  width: 1.2em;
}

.summary__points .point__index::before {
  color: var(--accent);
  content: "\\2713";
}

.section__rule {
  background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-warm));
  border-radius: 999px;
  height: 5px;
  position: relative;
  transform-origin: left center;
  width: min(620px, 72%);
}

.section__rule::after {
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 42%, transparent), transparent);
  content: "";
  height: 1px;
  left: 0;
  position: absolute;
  top: 16px;
  width: 100%;
}

.idea-card::before,
.cta-block::before {
  background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-warm));
  content: "";
  height: 3px;
  left: 0;
  position: absolute;
  right: 0;
  top: 0;
}

.idea-card,
.cta-block,
.comparison__side,
.quote-block,
.code-block {
  overflow: hidden;
}

.comparison__side::before {
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  content: "";
  height: 3px;
  left: 0;
  position: absolute;
  right: 0;
  top: 0;
}

.comparison__side--right::before {
  background: linear-gradient(90deg, var(--accent-warm), var(--accent-2));
}

.comparison__side h2 {
  color: var(--accent);
  letter-spacing: 0;
}

.comparison__side--right h2 {
  color: var(--accent-warm);
}

.comparison__side li::before {
  background: var(--accent);
  border-radius: 999px;
  content: "";
  height: 7px;
  left: 0;
  position: absolute;
  top: 0.64em;
  width: 7px;
}

.comparison__side--right li::before {
  background: var(--accent-warm);
}

.process-list li::after {
  background: linear-gradient(90deg, var(--accent), transparent);
  bottom: 0;
  content: "";
  height: 2px;
  left: 0;
  opacity: 0.8;
  position: absolute;
  right: 0;
}

.process-list--dense {
  gap: 16px;
}

.process-list--dense li {
  min-height: 86px;
  padding: 18px 22px;
}

.process-list--dense p {
  font-size: calc(var(--font-body) * 0.84);
}

body[data-format="landscape_1920x1080"] .process-list--grid,
body[data-format="square_1080x1080"] .process-list--grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

body[data-format="landscape_1920x1080"] .process-list--grid li,
body[data-format="square_1080x1080"] .process-list--grid li {
  align-content: start;
  align-items: start;
  gap: 22px;
  grid-template-columns: 1fr;
  min-height: 245px;
  padding: 28px;
}

body[data-format="landscape_1920x1080"] .process-list--grid p,
body[data-format="square_1080x1080"] .process-list--grid p {
  font-size: calc(var(--font-body) * 0.82);
}

body[data-format="landscape_1920x1080"] .process-list--dense,
body[data-format="square_1080x1080"] .process-list--dense {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.timeline {
  padding-left: 44px;
  position: relative;
}

.timeline__line {
  background: linear-gradient(var(--accent), var(--accent-2));
  bottom: 22px;
  left: 12px;
  position: absolute;
  top: 22px;
  transform-origin: top center;
  width: 4px;
}

.timeline__item span {
  background: var(--accent);
  border-radius: 999px;
  box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 40%, transparent);
  height: 18px;
  margin-left: -41px;
  width: 18px;
}

.quote-block {
  border-left: 4px solid var(--accent);
}

.quote-block::after {
  color: color-mix(in srgb, var(--accent) 20%, transparent);
  content: "\\201C";
  font-size: calc(var(--font-title) * 2);
  font-weight: 700;
  line-height: 1;
  position: absolute;
  right: 36px;
  top: 20px;
}

.stat-block strong {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: calc(var(--font-title) * 1.12);
  line-height: 0.95;
}

.stat-layout {
  display: grid;
  gap: 24px;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.35fr);
}

.stat-layout .stat-block {
  min-width: 0;
}

.stat-points .point {
  min-height: 0;
  padding: 19px 22px;
}

.stat-points .point p {
  font-size: calc(var(--font-body) * 0.8);
}

body[data-format="portrait_1080x1920"] .stat-layout {
  grid-template-columns: 1fr;
}

.chart-bar i {
  position: relative;
  width: var(--bar-value);
}

.chart-bar i::after {
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 32%));
  content: "";
  height: 100%;
  position: absolute;
  right: 0;
  width: 40%;
}

.code-block__header span:first-child {
  color: var(--accent);
}

body[data-format="landscape_1920x1080"] .code-block__body {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.code-line {
  border-bottom-color: var(--line-soft);
}

.code-line:nth-child(odd) {
  background: rgb(255 255 255 / 3%);
}

body[data-theme="clean-white"] .code-block,
body[data-theme="minimal-editorial"] .code-block,
body[data-theme="warm-paper"] .code-block {
  background:
    linear-gradient(135deg, rgb(17 24 39 / 96%), rgb(31 41 55 / 96%)),
    #111827;
  color-scheme: dark;
}

body[data-theme="clean-white"] .code-line code,
body[data-theme="minimal-editorial"] .code-line code,
body[data-theme="warm-paper"] .code-line code {
  color: #f9fafb;
}`
}

function captureCss(): string {
  return `body[data-capture="slide"] {
  height: var(--canvas-h);
  overflow: hidden;
  width: var(--canvas-w);
}

body[data-capture="slide"] .stage {
  height: var(--canvas-h);
  width: var(--canvas-w);
}

body[data-capture="slide"] .slide__chrome {
  opacity: 0.72;
}`
}

function escapeCssString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\a ')
}
