import type {Slide} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {Card} from '../layout/primitives.js'

export function CtaBlock({slide}: {slide: Slide}): ReactNode {
  const label = slide.points[0] ?? slide.subtitle ?? 'Next step'

  return (
    <Card className="cta-block relative grid gap-[28px] overflow-hidden rounded-deck-card border border-deck-line bg-deck-surface p-[44px_48px] shadow-deck-card">
      <p className="m-0 max-w-[25em] text-[calc(var(--font-heading)*0.9)] font-bold leading-[1.18] text-deck-fg">{label}</p>
    </Card>
  )
}
