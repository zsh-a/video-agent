import type {CSSProperties, ReactNode} from 'react'

import {Stack} from '../layout/primitives.js'

export function ChartBlock({points}: {points: string[]}): ReactNode {
  const bars = (points.length === 0 ? ['核心指标', '执行成本', '质量风险'] : points).slice(0, 4)

  return (
    <Stack className="chart-bars grid gap-[24px]">
      {bars.map((point, index) => (
        <div className="chart-bar point grid gap-[12px]" key={`${point}-${index}`} style={{'--bar-value': `${55 + index * 12}%`} as CSSProperties}>
          <span className="text-deck-caption text-deck-fg">{point}</span>
          <i className="block h-[20px] origin-left rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent-2))]" />
        </div>
      ))}
    </Stack>
  )
}
