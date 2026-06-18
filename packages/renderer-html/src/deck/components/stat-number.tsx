import type {DeckStat} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {Card} from '../layout/primitives.js'

export function StatNumber({stat}: {stat: DeckStat}): ReactNode {
  return (
    <Card className="stat-block grid gap-[18px] rounded-deck-card border border-deck-line bg-deck-surface p-[48px] shadow-deck-card">
      <strong className="text-[calc(var(--font-title)*1.12)] leading-[0.95] text-deck-accent">{stat.value}</strong>
      <span className="text-deck-body text-deck-fg">{stat.label}</span>
      {stat.caption === undefined ? null : <p className="m-0 text-deck-caption text-deck-muted">{stat.caption}</p>}
    </Card>
  )
}
