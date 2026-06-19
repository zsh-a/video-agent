import type {Slide} from '@video-agent/ir'
import type {ReactNode} from 'react'

export function TitleBlock({slide}: {slide: Pick<Slide, 'subtitle' | 'title'>}): ReactNode {
  return (
    <header className="slide__header grid gap-[18px]">
      <h1 className="slide__title m-0 max-w-[13em] text-balance text-deck-heading font-bold leading-deck-title text-deck-fg">{slide.title}</h1>
      {slide.subtitle === undefined ? null : (
        <p className="slide__subtitle m-0 max-w-[30em] text-deck-body leading-deck-body text-deck-muted">{slide.subtitle}</p>
      )}
    </header>
  )
}
