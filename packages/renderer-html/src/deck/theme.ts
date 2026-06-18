import type {Deck} from '@video-agent/ir'

import {deckAspectRatio, deckCanvasSize} from './format.js'

export function createDeckThemeCss(deck: Deck): string {
  const canvas = deckCanvasSize(deck.format)

  return [
    fontFaces(),
    `:root {
  color-scheme: dark;
  font-family: "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
  --canvas-w: ${canvas.width}px;
  --canvas-h: ${canvas.height}px;
  --aspect-ratio: ${deckAspectRatio(deck.format)};
  --safe-x: ${deck.format === 'portrait_1080x1920' ? '80px' : '120px'};
  --safe-top: ${deck.format === 'portrait_1080x1920' ? '120px' : '86px'};
  --safe-bottom: ${deck.format === 'portrait_1080x1920' ? '160px' : '92px'};
  --radius-lg: 28px;
  --radius-md: 8px;
  --font-title: ${deck.format === 'portrait_1080x1920' ? '76px' : '68px'};
  --font-heading: ${deck.format === 'portrait_1080x1920' ? '54px' : '48px'};
  --font-body: ${deck.format === 'portrait_1080x1920' ? '34px' : '30px'};
  --font-caption: 24px;
  --line-title: 1.08;
  --line-body: 1.34;
}`,
    themeTokens(),
    baseCss(),
    templateCss(),
    captureCss(),
  ].join('\n\n')
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
  return `body[data-theme="elegant-dark"] {
  --bg: #050816;
  --surface: rgb(255 255 255 / 8%);
  --surface-strong: rgb(255 255 255 / 14%);
  --surface-soft: rgb(15 23 42 / 86%);
  --fg: #f8fafc;
  --muted: #94a3b8;
  --line: rgb(148 163 184 / 26%);
  --accent: #38bdf8;
  --accent-2: #10b981;
  --accent-warm: #f59e0b;
  --glow: rgb(56 189 248 / 25%);
  --mesh-1: rgb(56 189 248 / 8%);
  --mesh-2: rgb(16 185 129 / 6%);
  --mesh-3: rgb(245 158 11 / 4%);
}

body[data-theme="clean-white"] {
  color-scheme: light;
  --bg: #f8fafc;
  --surface: rgb(15 23 42 / 5%);
  --surface-strong: rgb(15 23 42 / 10%);
  --surface-soft: #ffffff;
  --fg: #0f172a;
  --muted: #475569;
  --line: rgb(15 23 42 / 18%);
  --accent: #0f766e;
  --accent-2: #2563eb;
  --accent-warm: #c2410c;
  --glow: rgb(15 118 110 / 15%);
  --mesh-1: rgb(15 118 110 / 6%);
  --mesh-2: rgb(37 99 235 / 5%);
  --mesh-3: rgb(194 65 12 / 3%);
}

body[data-theme="finance-terminal"] {
  --bg: #06110d;
  --surface: rgb(187 247 208 / 8%);
  --surface-strong: rgb(187 247 208 / 14%);
  --surface-soft: rgb(2 44 34 / 70%);
  --fg: #ecfdf5;
  --muted: #86efac;
  --line: rgb(134 239 172 / 24%);
  --accent: #22c55e;
  --accent-2: #38bdf8;
  --accent-warm: #eab308;
  --glow: rgb(34 197 94 / 20%);
  --mesh-1: rgb(34 197 94 / 7%);
  --mesh-2: rgb(56 189 248 / 5%);
  --mesh-3: rgb(234 179 8 / 3%);
}

body[data-theme="tech-gradient"] {
  --bg: #07111f;
  --surface: rgb(226 232 240 / 8%);
  --surface-strong: rgb(226 232 240 / 15%);
  --surface-soft: rgb(15 23 42 / 82%);
  --fg: #f8fafc;
  --muted: #a7b5c7;
  --line: rgb(226 232 240 / 22%);
  --accent: #22d3ee;
  --accent-2: #a3e635;
  --accent-warm: #fb7185;
  --glow: rgb(34 211 238 / 20%);
  --mesh-1: rgb(34 211 238 / 7%);
  --mesh-2: rgb(163 230 53 / 5%);
  --mesh-3: rgb(251 113 133 / 4%);
}

body[data-theme="minimal-editorial"] {
  color-scheme: light;
  --bg: #f6f5f0;
  --surface: rgb(24 24 27 / 6%);
  --surface-strong: rgb(24 24 27 / 12%);
  --surface-soft: #fffefa;
  --fg: #18181b;
  --muted: #57534e;
  --line: rgb(68 64 60 / 20%);
  --accent: #1d4ed8;
  --accent-2: #0f766e;
  --accent-warm: #b45309;
  --glow: rgb(29 78 216 / 12%);
  --mesh-1: rgb(29 78 216 / 5%);
  --mesh-2: rgb(15 118 110 / 4%);
  --mesh-3: rgb(180 83 9 / 3%);
}

body[data-theme="warm-paper"] {
  color-scheme: light;
  --bg: #fff7ed;
  --surface: rgb(67 20 7 / 7%);
  --surface-strong: rgb(67 20 7 / 13%);
  --surface-soft: #fffbeb;
  --fg: #1c1917;
  --muted: #78716c;
  --line: rgb(120 113 108 / 24%);
  --accent: #0f766e;
  --accent-2: #7c3aed;
  --accent-warm: #ea580c;
  --glow: rgb(234 88 12 / 15%);
  --mesh-1: rgb(15 118 110 / 5%);
  --mesh-2: rgb(124 58 237 / 4%);
  --mesh-3: rgb(234 88 12 / 3%);
}`
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
  background: color-mix(in srgb, var(--bg) 86%, #000 14%);
  color: var(--fg);
  display: grid;
  justify-items: center;
  letter-spacing: 0;
  overflow: auto;
}

.stage {
  background:
    radial-gradient(ellipse 80% 60% at 15% 20%, var(--mesh-1), transparent),
    radial-gradient(ellipse 70% 50% at 85% 75%, var(--mesh-2), transparent),
    radial-gradient(ellipse 50% 40% at 50% 50%, var(--mesh-3), transparent),
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent 50%),
    linear-gradient(215deg, color-mix(in srgb, var(--accent-2) 5%, transparent), transparent 50%),
    var(--bg);
  height: var(--canvas-h);
  overflow: hidden;
  position: relative;
  width: var(--canvas-w);
}

.stage::before {
  background-image:
    linear-gradient(var(--line) 1px, transparent 1px),
    linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size: 72px 72px;
  content: "";
  inset: 0;
  opacity: 0.08;
  pointer-events: none;
  position: absolute;
}

.stage::after {
  background:
    radial-gradient(ellipse 40% 30% at 8% 8%, var(--glow), transparent),
    radial-gradient(ellipse 35% 25% at 92% 92%, color-mix(in srgb, var(--accent-2) 12%, transparent), transparent);
  content: "";
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: 0;
}

.slide {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  inset: 0;
  opacity: 0;
  padding: var(--safe-top) var(--safe-x) var(--safe-bottom);
  pointer-events: none;
  position: absolute;
  transform-origin: center;
  will-change: opacity, transform, filter;
}

.slide[data-active="true"] {
  pointer-events: auto;
}

.slide__chrome {
  align-items: center;
  color: var(--muted);
  display: flex;
  font-size: var(--font-caption);
  font-weight: 700;
  justify-content: space-between;
  letter-spacing: 0.08em;
  line-height: 1;
  opacity: 0.6;
  text-transform: uppercase;
}

.slide__content {
  align-content: center;
  display: grid;
  gap: 42px;
  min-height: 0;
  position: relative;
  z-index: 1;
}

.slide__header {
  display: grid;
  gap: 22px;
}

.slide__title {
  color: var(--fg);
  font-size: var(--font-heading);
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: var(--line-title);
  margin: 0;
  max-width: 12em;
  text-wrap: balance;
}

.slide__subtitle,
.slide__header p {
  color: var(--muted);
  font-size: var(--font-body);
  line-height: var(--line-body);
  margin: 0;
  max-width: 30em;
  overflow-wrap: break-word;
  word-break: keep-all;
}`
}

function templateCss(): string {
  return `.slide--hero .slide__content,
.slide--section .slide__content,
.slide--cta .slide__content {
  align-content: center;
}

.slide--hero .slide__title {
  background: linear-gradient(135deg, var(--fg), color-mix(in srgb, var(--accent) 70%, var(--fg)));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: var(--font-title);
  max-width: 10em;
}

.slide--section .slide__title {
  background: linear-gradient(90deg, var(--fg), color-mix(in srgb, var(--accent) 50%, var(--fg)));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero__points,
.points,
.summary__points {
  display: grid;
  gap: 20px;
}

.point {
  align-items: start;
  background: var(--surface);
  border: 1px solid var(--line);
  border-left: 3px solid color-mix(in srgb, var(--accent) 60%, transparent);
  border-radius: var(--radius-md);
  display: grid;
  gap: 18px;
  grid-template-columns: auto 1fr;
  padding: 24px 28px;
  will-change: opacity, transform, filter;
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

.section__rule {
  background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-warm));
  border-radius: 999px;
  height: 6px;
  position: relative;
  transform-origin: left center;
  width: min(560px, 70%);
}

.section__rule::after {
  background: linear-gradient(90deg, var(--glow), transparent);
  border-radius: 999px;
  content: "";
  height: 20px;
  left: 0;
  position: absolute;
  top: -7px;
  width: 100%;
}

.idea-card,
.quote-block,
.stat-block,
.cta-block,
.code-block,
.comparison__side {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  position: relative;
}

.idea-card::before,
.cta-block::before {
  background: linear-gradient(135deg, var(--glow), transparent 60%);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  content: "";
  height: 4px;
  left: 0;
  position: absolute;
  right: 0;
  top: 0;
}

.idea-card,
.cta-block {
  padding: 48px 52px;
}

.idea-card p,
.cta-block p {
  color: var(--fg);
  font-size: calc(var(--font-heading) * 0.9);
  font-weight: 700;
  line-height: 1.18;
  margin: 0;
}

.comparison {
  display: grid;
  gap: 24px;
  grid-template-columns: 1fr 1fr;
}

.comparison__side {
  display: grid;
  gap: 24px;
  padding: 32px;
}

.comparison__side::before {
  background: linear-gradient(180deg, var(--accent), transparent);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  content: "";
  height: 3px;
  left: 0;
  position: absolute;
  right: 0;
  top: 0;
}

.comparison__side--right::before {
  background: linear-gradient(180deg, var(--accent-warm), transparent);
}

.comparison__side h2 {
  color: var(--accent);
  font-size: calc(var(--font-body) * 0.95);
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.2;
  margin: 0;
}

.comparison__side--right h2 {
  color: var(--accent-warm);
}

.comparison__side ul {
  display: grid;
  gap: 16px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.comparison__side li {
  color: var(--fg);
  font-size: calc(var(--font-body) * 0.82);
  line-height: var(--line-body);
  padding-left: 16px;
  position: relative;
}

.comparison__side li::before {
  color: var(--accent);
  content: "\\2022";
  font-size: 1.1em;
  left: 0;
  position: absolute;
}

.comparison__side--right li::before {
  color: var(--accent-warm);
}

.process-list {
  counter-reset: process;
  display: grid;
  gap: 18px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.process-list li {
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--line);
  border-left: 3px solid color-mix(in srgb, var(--accent) 50%, transparent);
  border-radius: var(--radius-md);
  display: grid;
  gap: 22px;
  grid-template-columns: auto 1fr;
  min-height: 104px;
  padding: 24px 28px;
}

.process-list--dense {
  gap: 16px;
}

.process-list--dense li {
  min-height: 88px;
  padding: 20px 24px;
}

.process-list--dense p {
  font-size: calc(var(--font-body) * 0.88);
}

body[data-format="landscape_1920x1080"] .process-list--dense,
body[data-format="square_1080x1080"] .process-list--dense {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.timeline {
  display: grid;
  gap: 20px;
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

.timeline__line::after {
  background: linear-gradient(180deg, var(--glow), transparent);
  border-radius: 999px;
  content: "";
  height: 100%;
  left: -6px;
  position: absolute;
  top: 0;
  width: 16px;
}

.timeline__item {
  align-items: center;
  display: grid;
  gap: 18px;
  grid-template-columns: auto 1fr;
}

.timeline__item span {
  background: var(--accent);
  border-radius: 999px;
  box-shadow: 0 0 12px var(--glow);
  height: 20px;
  margin-left: -41px;
  width: 20px;
}

.quote-block {
  border-left: 4px solid var(--accent);
  display: grid;
  gap: 26px;
  margin: 0;
  padding: 48px;
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

.quote-block blockquote {
  color: var(--fg);
  font-size: calc(var(--font-heading) * 0.9);
  font-weight: 700;
  line-height: 1.2;
  margin: 0;
}

.quote-block figcaption {
  color: var(--muted);
  font-size: var(--font-caption);
  letter-spacing: 0.02em;
}

.stat-block {
  display: grid;
  gap: 18px;
  padding: 48px;
}

.stat-block strong {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: calc(var(--font-title) * 1.15);
  line-height: 0.95;
}

.stat-block span {
  color: var(--fg);
  font-size: var(--font-body);
}

.stat-block p {
  color: var(--muted);
  font-size: var(--font-caption);
  margin: 0;
}

.stat-layout {
  align-items: stretch;
  display: grid;
  gap: 24px;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.35fr);
}

.stat-layout .stat-block {
  min-width: 0;
}

.stat-points {
  display: grid;
  gap: 16px;
}

.stat-points .point {
  min-height: 0;
  padding: 20px 24px;
}

.stat-points .point p {
  font-size: calc(var(--font-body) * 0.82);
}

body[data-format="portrait_1080x1920"] .stat-layout {
  grid-template-columns: 1fr;
}

.chart-bars {
  display: grid;
  gap: 24px;
}

.chart-bar {
  display: grid;
  gap: 12px;
}

.chart-bar span {
  color: var(--fg);
  font-size: var(--font-caption);
}

.chart-bar i {
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  border-radius: 999px;
  display: block;
  height: 22px;
  position: relative;
  transform-origin: left center;
  width: var(--bar-value);
}

.chart-bar i::after {
  background: linear-gradient(90deg, transparent, var(--glow));
  border-radius: 999px;
  content: "";
  height: 100%;
  position: absolute;
  right: 0;
  width: 40%;
}

.code-block {
  color: #e5e7eb;
  font-family: ui-monospace, "SFMono-Regular", "SF Mono", Consolas, monospace;
  font-size: calc(var(--font-caption) * 1.05);
  line-height: 1.55;
  margin: 0;
  overflow: hidden;
  padding: 34px;
  position: relative;
  white-space: pre-wrap;
}

.code-block::before {
  color: color-mix(in srgb, var(--accent) 60%, #94a3b8);
  content: attr(data-language);
  font-size: calc(var(--font-caption) * 0.75);
  font-weight: 700;
  letter-spacing: 0.1em;
  position: absolute;
  right: 20px;
  text-transform: uppercase;
  top: 12px;
}

body[data-theme="clean-white"] .code-block,
body[data-theme="minimal-editorial"] .code-block,
body[data-theme="warm-paper"] .code-block {
  background: #111827;
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
  display: none;
}`
}
