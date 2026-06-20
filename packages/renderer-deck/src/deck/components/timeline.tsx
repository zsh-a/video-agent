import type {ReactNode} from 'react'

export function Timeline({points}: {points: string[]}): ReactNode {
  if (points.length > 5) {
    throw new Error(`Deck timeline received ${points.length} points, exceeding renderer limit 5.`)
  }

  if (points.length === 0) {
    throw new Error('Deck timeline requires at least one LLM-authored visible item; no empty timeline render fallback is allowed.')
  }

  return (
    <div className="timeline relative grid gap-[20px] pl-[44px]">
      <div className="timeline__line absolute bottom-[22px] left-[12px] top-[22px] w-[4px] origin-top bg-[linear-gradient(var(--accent),var(--accent-2))]" />
      {points.map((point) => <TimelineItem key={point} point={point} />)}
    </div>
  )
}

export function TimelineItem({point}: {point: string}): ReactNode {
  return (
    <div className="timeline__item point grid grid-cols-[auto_1fr] items-center gap-[18px]">
      <span className="ml-[-41px] h-[18px] w-[18px] rounded-full bg-deck-accent shadow-[0_0_18px_color-mix(in_srgb,var(--accent)_40%,transparent)]" />
      <p className="m-0 text-deck-body leading-deck-body text-deck-fg">{point}</p>
    </div>
  )
}
