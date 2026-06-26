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
      <div className="cta-block__arrow-wrap" aria-hidden="true">
        <svg className="cta-block__arrow h-[48px] w-[48px] text-deck-accent" fill="none" viewBox="0 0 48 48">
          <path d="M12 24h24M28 16l8 8-8 8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        </svg>
        <div className="cta-block__arrow-glow" />
      </div>
      <div className="cta-block__glow" aria-hidden="true" />
      <div className="cta-block__ring" aria-hidden="true" />
    </Card>
  )
}
