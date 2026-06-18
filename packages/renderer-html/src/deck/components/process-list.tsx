import type {ReactNode} from 'react'

import {classNames} from '../layout/primitives.js'

export function ProcessList({points}: {points: string[]}): ReactNode {
  const items = points.slice(0, 7)
  const densityClass = items.length > 4 ? 'process-list--dense' : items.length >= 3 ? 'process-list--grid' : ''

  if (items.length === 0) {
    return null
  }

  return (
    <ol className={classNames('process-list grid list-none gap-[18px] p-0 m-0', densityClass)}>
      {items.map((point, index) => <ProcessStep index={index} key={`${point}-${index}`} point={point} />)}
    </ol>
  )
}

export function ProcessStep({index, point}: {index: number; point: string}): ReactNode {
  return (
    <li className="point relative grid min-h-[100px] grid-cols-[auto_1fr] items-center gap-[18px] overflow-hidden rounded-deck-card border border-deck-line bg-deck-surface p-[22px_25px] shadow-deck-card">
      <span className="text-deck-caption font-bold leading-[1.2] text-deck-accent">{String(index + 1).padStart(2, '0')}</span>
      <p className="m-0 text-deck-body leading-deck-body text-deck-fg">{point}</p>
    </li>
  )
}
