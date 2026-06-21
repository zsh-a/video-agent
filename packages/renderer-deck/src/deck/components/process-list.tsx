import type {ReactNode} from 'react'
import type {DeckProcess, DeckProcessStep} from '@video-agent/ir'

import {classNames} from '../layout/primitives.js'

export function ProcessList({process}: {process: DeckProcess}): ReactNode {
  if (process.steps.length > 7) {
    throw new Error(`Deck process list received ${process.steps.length} steps, exceeding renderer limit 7.`)
  }

  const steps = process.steps
  const densityClass = steps.length > 5 ? 'process-list--dense' : steps.length >= 3 ? 'process-list--grid' : ''

  if (steps.length < 2) {
    throw new Error('Deck process list requires at least two LLM-authored visible steps; no empty process render fallback is allowed.')
  }

  return (
    <ol className={classNames('process-list grid list-none gap-[18px] p-0 m-0', densityClass)}>
      {steps.map((step, index) => <ProcessStep index={index} key={`${step.label}-${index}`} step={step} />)}
    </ol>
  )
}

export function ProcessStep({index, step}: {index: number; step: DeckProcessStep}): ReactNode {
  return (
    <li className="point relative grid min-h-[100px] grid-cols-[auto_1fr] items-center gap-[20px] overflow-hidden rounded-deck-card border border-deck-line bg-deck-surface p-[22px_25px] shadow-deck-card">
      <span className="process-step__badge">{String(index + 1).padStart(2, '0')}</span>
      <div className="process-step__copy">
        <p className="process-step__label m-0 text-deck-body leading-deck-body text-deck-fg">{step.label}</p>
        {step.detail === undefined ? null : <p className="process-step__detail m-0">{step.detail}</p>}
      </div>
    </li>
  )
}
