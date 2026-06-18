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
  --safe-x: ${deck.format === 'portrait_1080x1920' ? '78px' : '118px'};
  --safe-top: ${deck.format === 'portrait_1080x1920' ? '96px' : '68px'};
  --safe-bottom: ${deck.format === 'portrait_1080x1920' ? '132px' : '74px'};
  --radius-md: 8px;
  --radius-sm: 4px;
  --font-title: ${deck.format === 'portrait_1080x1920' ? '74px' : '76px'};
  --font-heading: ${deck.format === 'portrait_1080x1920' ? '52px' : '48px'};
  --font-body: ${deck.format === 'portrait_1080x1920' ? '31px' : '28px'};
  --font-caption: ${deck.format === 'portrait_1080x1920' ? '22px' : '20px'};
  --line-title: 1.08;
  --line-body: 1.38;
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
  --bg: #080b12;
  --bg-2: #111827;
  --surface: rgb(244 248 255 / 8%);
  --surface-strong: rgb(244 248 255 / 14%);
  --surface-soft: rgb(15 23 42 / 72%);
  --fg: #f7fafc;
  --muted: #aeb9c8;
  --line: rgb(217 226 239 / 22%);
  --line-soft: rgb(217 226 239 / 10%);
  --accent: #56d6ff;
  --accent-2: #58e6a9;
  --accent-warm: #f6c96b;
  --shadow: rgb(0 0 0 / 34%);
}

body[data-theme="clean-white"] {
  color-scheme: light;
  --bg: #f7f8f5;
  --bg-2: #e9eee9;
  --surface: rgb(10 16 24 / 5%);
  --surface-strong: rgb(10 16 24 / 9%);
  --surface-soft: rgb(255 255 255 / 82%);
  --fg: #121619;
  --muted: #5b6670;
  --line: rgb(18 22 25 / 16%);
  --line-soft: rgb(18 22 25 / 8%);
  --accent: #0b7f72;
  --accent-2: #2563eb;
  --accent-warm: #b45309;
  --shadow: rgb(16 24 40 / 12%);
}

body[data-theme="finance-terminal"] {
  --bg: #07100f;
  --bg-2: #111b1d;
  --surface: rgb(237 248 244 / 8%);
  --surface-strong: rgb(237 248 244 / 15%);
  --surface-soft: rgb(9 28 27 / 74%);
  --fg: #f4fff9;
  --muted: #a7bbb3;
  --line: rgb(196 231 218 / 20%);
  --line-soft: rgb(196 231 218 / 9%);
  --accent: #43e59b;
  --accent-2: #4cc9f0;
  --accent-warm: #f2c15d;
  --shadow: rgb(0 0 0 / 36%);
}

body[data-theme="tech-gradient"] {
  --bg: #071019;
  --bg-2: #101827;
  --surface: rgb(226 240 255 / 8%);
  --surface-strong: rgb(226 240 255 / 15%);
  --surface-soft: rgb(15 24 38 / 78%);
  --fg: #f8fbff;
  --muted: #a8b8c9;
  --line: rgb(213 233 255 / 20%);
  --line-soft: rgb(213 233 255 / 9%);
  --accent: #31d8ff;
  --accent-2: #b8ec5b;
  --accent-warm: #fb8b96;
  --shadow: rgb(0 0 0 / 34%);
}

body[data-theme="minimal-editorial"] {
  color-scheme: light;
  --bg: #f6f4ef;
  --bg-2: #e9e4da;
  --surface: rgb(24 24 27 / 6%);
  --surface-strong: rgb(24 24 27 / 11%);
  --surface-soft: rgb(255 254 250 / 84%);
  --fg: #191a1d;
  --muted: #64605a;
  --line: rgb(54 50 45 / 18%);
  --line-soft: rgb(54 50 45 / 8%);
  --accent: #1d4ed8;
  --accent-2: #0f766e;
  --accent-warm: #b45309;
  --shadow: rgb(30 41 59 / 12%);
}

body[data-theme="warm-paper"] {
  color-scheme: light;
  --bg: #fff7ed;
  --bg-2: #f0e2cf;
  --surface: rgb(67 20 7 / 7%);
  --surface-strong: rgb(67 20 7 / 12%);
  --surface-soft: rgb(255 251 235 / 82%);
  --fg: #1c1917;
  --muted: #72695f;
  --line: rgb(120 113 108 / 20%);
  --line-soft: rgb(120 113 108 / 9%);
  --accent: #0f766e;
  --accent-2: #5b6ee1;
  --accent-warm: #d97706;
  --shadow: rgb(67 20 7 / 12%);
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
  inset: 0;
  opacity: 0;
  padding: var(--safe-top) var(--safe-x) var(--safe-bottom);
  pointer-events: none;
  position: absolute;
  transform-origin: center;
  will-change: opacity, transform, filter;
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

.slide__chrome {
  align-items: center;
  border-bottom: 1px solid var(--line-soft);
  color: var(--muted);
  display: flex;
  font-size: var(--font-caption);
  font-weight: 700;
  justify-content: space-between;
  letter-spacing: 0;
  line-height: 1;
  opacity: 0.76;
  padding-bottom: 22px;
  position: relative;
  z-index: 2;
}

.slide__chrome span:first-child {
  color: var(--accent);
}

.slide__content {
  align-content: center;
  display: grid;
  gap: 34px;
  min-height: 0;
  padding-top: 34px;
  position: relative;
  z-index: 1;
}

.slide__header {
  display: grid;
  gap: 18px;
}

.slide__title {
  color: var(--fg);
  font-size: var(--font-heading);
  font-weight: 700;
  letter-spacing: 0;
  line-height: var(--line-title);
  margin: 0;
  max-width: 13em;
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

.point {
  align-items: start;
  background:
    linear-gradient(135deg, var(--surface-strong), var(--surface-soft)),
    var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  box-shadow: 0 24px 70px var(--shadow);
  display: grid;
  gap: 18px;
  grid-template-columns: auto 1fr;
  overflow: hidden;
  padding: 22px 26px;
  position: relative;
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
  box-shadow: 0 24px 80px var(--shadow);
  position: relative;
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
.cta-block {
  display: grid;
  gap: 28px;
  overflow: hidden;
  padding: 44px 48px;
}

.idea-card__headline,
.cta-block p {
  color: var(--fg);
  font-size: calc(var(--font-heading) * 0.9);
  font-weight: 700;
  line-height: 1.18;
  margin: 0;
  max-width: 25em;
}

.idea-card__support {
  border-top: 1px solid var(--line-soft);
  display: grid;
  gap: 12px;
  padding-top: 24px;
}

.idea-card__support span {
  color: var(--muted);
  font-size: calc(var(--font-body) * 0.82);
  line-height: var(--line-body);
}

.comparison {
  display: grid;
  gap: 24px;
  grid-template-columns: 1fr 1fr;
}

.comparison__side {
  display: grid;
  gap: 24px;
  overflow: hidden;
  padding: 34px;
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
  font-size: calc(var(--font-body) * 0.94);
  font-weight: 700;
  letter-spacing: 0;
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
  padding-left: 20px;
  position: relative;
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
  background:
    linear-gradient(135deg, var(--surface-strong), var(--surface-soft)),
    var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  box-shadow: 0 22px 72px var(--shadow);
  display: grid;
  gap: 18px;
  grid-template-columns: auto 1fr;
  min-height: 100px;
  overflow: hidden;
  padding: 22px 25px;
  position: relative;
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

.timeline__item {
  align-items: center;
  display: grid;
  gap: 18px;
  grid-template-columns: auto 1fr;
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
  display: grid;
  gap: 26px;
  margin: 0;
  overflow: hidden;
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
  letter-spacing: 0;
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
  font-size: calc(var(--font-title) * 1.12);
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
  padding: 19px 22px;
}

.stat-points .point p {
  font-size: calc(var(--font-body) * 0.8);
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
  height: 20px;
  position: relative;
  transform-origin: left center;
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

.code-block {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.code-block__header {
  align-items: center;
  border-bottom: 1px solid var(--line-soft);
  color: var(--muted);
  display: flex;
  font-size: var(--font-caption);
  font-weight: 700;
  justify-content: space-between;
  letter-spacing: 0;
  padding: 18px 24px;
}

.code-block__header span:first-child {
  color: var(--accent);
}

.code-block__body {
  display: grid;
  gap: 0;
  padding: 12px;
}

body[data-format="landscape_1920x1080"] .code-block__body {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.code-line {
  align-items: center;
  border: 1px solid transparent;
  border-bottom-color: var(--line-soft);
  display: grid;
  gap: 14px;
  grid-template-columns: 44px minmax(0, 1fr);
  min-height: 52px;
  padding: 11px 14px;
}

.code-line:nth-child(odd) {
  background: rgb(255 255 255 / 3%);
}

.code-line__index {
  color: var(--accent-2);
  font-size: calc(var(--font-caption) * 0.9);
  font-weight: 700;
}

.code-line code {
  color: var(--fg);
  font-family: "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
  font-size: calc(var(--font-body) * 0.78);
  line-height: 1.28;
  overflow-wrap: break-word;
  white-space: normal;
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
