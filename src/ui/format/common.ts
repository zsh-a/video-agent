import type {TuiSnapshot} from '../model.js'

import {PROJECT_EVENT_KIND_PIPELINE} from '@video-agent/runtime'

export function formatRender(render: NonNullable<TuiSnapshot['selected']>['summary']['render']): string {
  if (!render.rendered) {
    return 'none'
  }

  return `${render.renderer ?? 'unknown'} (${render.outputErrors} output errors, ${render.visualErrors} visual errors)`
}

export function formatEvent(event: TuiSnapshot['events'][number]): string {
  if (event.kind === PROJECT_EVENT_KIND_PIPELINE) {
    return `${event.time} pipeline ${event.event.type}${event.event.stage === undefined ? '' : ` ${event.event.stage}`}${event.event.message === undefined ? '' : ` ${event.event.message}`}`
  }

  return `${event.time} provider ${event.event.role} ${event.event.operation} ${event.event.status} ${event.event.durationMs}ms`
}

export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size}B`
  }

  const kb = size / 1024

  if (kb < 1024) {
    return `${kb.toFixed(1)}KB`
  }

  return `${(kb / 1024).toFixed(1)}MB`
}

export function formatIssueSummary(snapshot: TuiSnapshot | undefined): string {
  const quality = snapshot?.selected?.summary.quality

  if (quality === undefined) {
    return 'no project'
  }

  return `${quality.issues} issues, ${quality.errors} errors`
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`
}

export function truncateText(value: string, width: number): string {
  if (value.length <= width) {
    return value
  }

  if (width <= 1) {
    return value.slice(0, width)
  }

  return `${value.slice(0, width - 1)}…`
}
