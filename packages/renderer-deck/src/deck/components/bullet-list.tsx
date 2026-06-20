import type {ReactNode} from 'react'

import {Card, Stack, classNames} from '../layout/primitives.js'

export function BulletList({className, max, points}: {className: string; max: number; points: string[]}): ReactNode {
  if (points.length > max) {
    throw new Error(`Deck bullet list received ${points.length} points, exceeding renderer limit ${max}.`)
  }

  const items = points

  if (items.length === 0) {
    throw new Error('Deck bullet list requires at least one LLM-authored visible point; no empty list render fallback is allowed.')
  }

  return (
    <Stack className={classNames(className, 'grid gap-[18px]')}>
      {items.map((point, index) => <PointCard index={index} key={`${point}-${index}`} point={point} />)}
    </Stack>
  )
}

export function PointCard({index, point}: {index: number; point: string}): ReactNode {
  return (
    <Card className="point relative grid grid-cols-[auto_1fr] items-start gap-[18px] overflow-hidden rounded-deck-card border border-deck-line bg-deck-surface p-[22px_26px] shadow-deck-card">
      <span className="point__index text-deck-caption font-bold leading-[1.2] text-deck-accent">{String(index + 1).padStart(2, '0')}</span>
      <p className="m-0 text-deck-body leading-deck-body text-deck-fg">{point}</p>
    </Card>
  )
}
