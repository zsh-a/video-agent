import type {DeckFormat} from '@video-agent/ir'

export interface DeckCanvasSize {
  height: number
  width: number
}

export function deckCanvasSize(format: DeckFormat): DeckCanvasSize {
  if (format === 'landscape_1920x1080') {
    return {height: 1080, width: 1920}
  }

  if (format === 'square_1080x1080') {
    return {height: 1080, width: 1080}
  }

  return {height: 1920, width: 1080}
}

export function deckAspectRatio(format: DeckFormat): string {
  const size = deckCanvasSize(format)

  return `${size.width} / ${size.height}`
}
