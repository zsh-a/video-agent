import type {DeckChart} from '@video-agent/ir'
import type {CSSProperties, ReactNode} from 'react'

import {Stack} from '../layout/primitives.js'

export function ChartBlock({chart}: {chart: DeckChart}): ReactNode {
  return (
    <Stack className="chart-bars grid gap-[24px]">
      {chart.bars.map((bar, index) => (
        <div className="chart-bar point grid gap-[12px]" key={`${bar.label}-${index}`} style={{'--bar-value': `${Math.round(bar.value * 100)}%`} as CSSProperties}>
          <span className="text-deck-caption text-deck-fg">{bar.label}</span>
          <i className="block h-[20px] origin-left rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent-2))]" />
          {bar.caption === undefined ? null : <span className="text-[calc(var(--font-caption)*0.9)] text-deck-muted">{bar.caption}</span>}
        </div>
      ))}
      {chart.valueLabel === undefined ? null : <span className="text-deck-caption text-deck-muted">{chart.valueLabel}</span>}
    </Stack>
  )
}
