import type {DeckChart, DeckChartBar} from '@video-agent/ir'
import type {CSSProperties, ReactNode} from 'react'

import {Card, Stack, classNames} from '../layout/primitives.js'

export function ChartBlock({chart}: {chart: DeckChart}): ReactNode {
  if (chart.type === 'donut') {
    return <DonutChart chart={chart} />
  }

  return <BarChart chart={chart} />
}

function BarChart({chart}: {chart: DeckChart}): ReactNode {
  return (
    <Stack className="chart-bars grid gap-[24px]">
      {chart.bars.map((bar, index) => (
        <BarChartRow bar={bar} index={index} key={`${bar.label}-${index}`} />
      ))}
      {chart.valueLabel === undefined ? null : <span className="text-deck-caption text-deck-muted">{chart.valueLabel}</span>}
    </Stack>
  )
}

function BarChartRow({bar, index}: {bar: DeckChartBar; index: number}): ReactNode {
  const pct = Math.round(bar.value * 100)

  return (
    <div className="chart-bar point grid gap-[12px]" style={{'--bar-value': `${pct}%`} as CSSProperties}>
      <div className="chart-bar__header flex items-baseline justify-between gap-[12px]">
        <span className="text-deck-caption text-deck-fg">{bar.label}</span>
        <span className="chart-bar__value text-deck-caption font-bold text-deck-accent">{pct}%</span>
      </div>
      <div className="chart-bar__track relative h-[20px] overflow-hidden rounded-full bg-deck-surface">
        <i className="chart-bar__fill absolute inset-y-0 left-0 origin-left rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent-2))]" />
        <div className="chart-bar__shine" aria-hidden="true" />
      </div>
      {bar.caption === undefined ? null : <span className="text-[calc(var(--font-caption)*0.9)] text-deck-muted">{bar.caption}</span>}
    </div>
  )
}

function DonutChart({chart}: {chart: DeckChart}): ReactNode {
  const total = chart.bars.reduce((sum, bar) => sum + bar.value, 0)
  let cumulative = 0

  return (
    <div className="donut-layout grid items-center gap-[36px]" style={{'--donut-cols': chart.bars.length <= 2 ? '1fr' : 'minmax(0, 1.2fr) minmax(0, 1fr)'} as CSSProperties}>
      <div className="donut-ring relative mx-auto aspect-square w-[240px]">
        <svg className="donut-ring__svg h-full w-full -rotate-90" viewBox="0 0 100 100">
          {chart.bars.map((bar, index) => {
            const fraction = total > 0 ? bar.value / total : 0
            const circumference = 2 * Math.PI * 38
            const dashLength = fraction * circumference
            const dashOffset = -cumulative * circumference
            cumulative += fraction

            return (
              <circle
                className="donut-ring__segment"
                cx="50"
                cy="50"
                fill="none"
                key={`${bar.label}-${index}`}
                r="38"
                stroke={`var(--donut-color-${index})`}
                strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                strokeWidth="10"
              />
            )
          })}
        </svg>
        <div className="donut-ring__center absolute inset-0 grid place-items-center">
          <span className="text-deck-heading font-bold text-deck-fg">{chart.bars.length}</span>
        </div>
      </div>
      <div className="donut-legend grid gap-[14px]">
        {chart.bars.map((bar, index) => (
          <div className="donut-legend__item grid grid-cols-[auto_1fr_auto] items-center gap-[12px]" key={`${bar.label}-${index}`}>
            <span className="donut-legend__dot h-[14px] w-[14px] rounded-full" style={{background: `var(--donut-color-${index})`} as CSSProperties} />
            <span className="text-deck-caption text-deck-fg">{bar.label}</span>
            <span className="text-deck-caption font-bold text-deck-accent">{Math.round((total > 0 ? bar.value / total : 0) * 100)}%</span>
          </div>
        ))}
      </div>
      {chart.valueLabel === undefined ? null : (
        <span className="donut-label col-span-full text-center text-deck-caption text-deck-muted">{chart.valueLabel}</span>
      )}
    </div>
  )
}
