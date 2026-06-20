import type {Slide} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {Card} from '../layout/primitives.js'

export function CtaBlock({slide}: {slide: Slide}): ReactNode {
  const label = slide.points[0]

  if (label === undefined) {
    throw new Error(`Deck cta slide "${slide.slideId}" is missing an LLM-authored action point.`)
  }

  return (
    <Card className="cta-block relative grid gap-[28px] overflow-hidden rounded-deck-card border-2 border-deck-accent bg-deck-surface p-[48px_52px] shadow-deck-card text-center justify-items-center">
      <p className="cta-block__label m-0 max-w-[22em] text-[calc(var(--font-heading)*0.92)] font-bold leading-[1.18] text-deck-fg">{label}</p>
      <span className="cta-block__arrow text-deck-accent text-[var(--font-heading)] font-bold" aria-hidden="true">→</span>
      <div className="cta-block__glow" aria-hidden="true" />
    </Card>
  )
}
