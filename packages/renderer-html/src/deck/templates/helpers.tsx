import type {DeckCodeBlock, DeckComparison, DeckQuote, Slide} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {BulletList, IdeaCard} from '../components/index.js'

export function ReadableFallback({slide}: {slide: Slide}): ReactNode {
  return slide.points.length > 0
    ? <BulletList className="points" max={4} points={slide.points} />
    : <IdeaCard slide={slide} />
}

export function comparisonForSlide(slide: Slide): DeckComparison | undefined {
  if (
    slide.comparison !== undefined &&
    slide.comparison.left.points.length > 0 &&
    slide.comparison.right.points.length > 0
  ) {
    return slide.comparison
  }

  return undefined
}

export function quoteForSlide(slide: Slide): DeckQuote {
  return slide.quote ?? {
    text: slide.points[0] ?? slide.speakerNote ?? slide.title,
  }
}

export function codeForSlide(slide: Slide): DeckCodeBlock {
  return slide.code ?? {
    language: 'text',
    text: slide.points.join('\n') || slide.title,
  }
}
