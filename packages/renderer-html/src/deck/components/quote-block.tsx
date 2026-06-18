import type {DeckQuote} from '@video-agent/ir'
import type {ReactNode} from 'react'

export function QuoteBlock({quote}: {quote: DeckQuote}): ReactNode {
  return (
    <figure className="quote-block relative m-0 grid gap-[26px] overflow-hidden rounded-deck-card border border-l-4 border-deck-line border-l-deck-accent bg-deck-surface p-[48px] shadow-deck-card">
      <blockquote className="m-0 text-[calc(var(--font-heading)*0.9)] font-bold leading-[1.2] text-deck-fg">{quote.text}</blockquote>
      {quote.attribution === undefined ? null : <figcaption className="text-deck-caption text-deck-muted">{quote.attribution}</figcaption>}
    </figure>
  )
}
