import type {Slide} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {Card, Stack} from '../layout/primitives.js'

export function IdeaCard({slide}: {slide: Slide}): ReactNode {
  const idea = slide.points[0] ?? slide.subtitle ?? slide.speakerNote ?? slide.title
  const support = slide.points.slice(1, 3)

  return (
    <Card className="idea-card relative grid gap-[28px] overflow-hidden rounded-deck-card border border-deck-line bg-deck-surface p-[44px_48px] shadow-deck-card">
      <p className="idea-card__headline m-0 max-w-[25em] text-[calc(var(--font-heading)*0.9)] font-bold leading-[1.18] text-deck-fg">{idea}</p>
      {support.length === 0 ? null : (
        <Stack className="idea-card__support grid gap-[12px] border-t border-deck-line-soft pt-[24px]">
          {support.map((point) => <span className="text-[calc(var(--font-body)*0.82)] leading-deck-body text-deck-muted" key={point}>{point}</span>)}
        </Stack>
      )}
    </Card>
  )
}
