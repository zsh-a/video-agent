import type {ReactNode} from 'react'

import {classNames} from '../layout/primitives.js'

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
      {points.map((point, index) => <TimelineItem index={index} key={point} point={point} />)}
    </div>
  )
}

export function TimelineItem({index, point}: {index: number; point: string}): ReactNode {
  const variant = index % 3

  return (
    <div className={classNames('timeline__item point grid grid-cols-[auto_1fr] items-center gap-[18px]', `timeline__item--${variant}`)}>
      <span className={classNames('timeline__node ml-[-41px] grid h-[22px] w-[22px] place-items-center rounded-full', `timeline__node--${variant}`)}>
        <span className="timeline__node-inner h-[10px] w-[10px] rounded-full bg-deck-bg" />
      </span>
      <p className="m-0 text-deck-body leading-deck-body text-deck-fg">{point}</p>
    </div>
  )
}
