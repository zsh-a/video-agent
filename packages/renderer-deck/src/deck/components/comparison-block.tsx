import type {DeckComparison} from '@video-agent/ir'
import type {ReactNode} from 'react'

export function ComparisonBlock({comparison}: {comparison: DeckComparison}): ReactNode {
  return (
    <div className="comparison grid grid-cols-2 gap-[24px]">
      <CompareColumn side={comparison.left} sideClass="left" />
      <CompareColumn side={comparison.right} sideClass="right" />
    </div>
  )
}

export function CompareColumn({side, sideClass}: {side: DeckComparison['left']; sideClass: 'left' | 'right'}): ReactNode {
  return (
    <section className={`comparison__side comparison__side--${sideClass} relative grid gap-[24px] overflow-hidden rounded-deck-card border border-deck-line bg-deck-surface p-[34px] shadow-deck-card`}>
      <h2 className="m-0 text-[calc(var(--font-body)*0.94)] font-bold leading-[1.2] text-deck-accent">{side.label}</h2>
      <ul className="grid list-none gap-[16px] p-0 m-0">
        {side.points.slice(0, 3).map((point) => <li className="relative pl-[20px] text-[calc(var(--font-body)*0.82)] leading-deck-body text-deck-fg" key={point}>{point}</li>)}
      </ul>
    </section>
  )
}
