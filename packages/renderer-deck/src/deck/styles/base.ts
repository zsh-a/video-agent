import type {Deck} from '@video-agent/ir'

import {deckCanvasSize} from '../format.js'

import baseStyles from './base.css' with { type: 'text' }

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
  return baseStyles
}
