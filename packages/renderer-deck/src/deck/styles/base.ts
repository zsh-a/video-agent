import type {Deck} from '@video-agent/ir'

import {deckCanvasSize} from '../format.js'

export function rootTokensCss(deck: Deck): string {
  const canvas = deckCanvasSize(deck.format)

  return `:root {
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
}`
}

export function baseCss(): string {
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
}

.slide--quiet .slide__content {
  gap: 42px;
}

.slide--quiet .slide__title {
  font-size: var(--font-title);
}

body[data-format="portrait_1080x1920"] .slide__content {
  gap: 28px;
}

body[data-format="portrait_1080x1920"] .slide__title {
  font-size: calc(var(--font-title) * 0.88);
  max-width: 11em;
}

body[data-format="portrait_1080x1920"] .slide--dense .slide__title {
  font-size: calc(var(--font-heading) * 0.86);
}`
}
