import type {ProjectEventRecord} from '@video-agent/runtime'

export function formatEvents(events: ProjectEventRecord[]): string[] {
  if (events.length === 0) {
    return ['  none']
  }

  return events.map((event) => `  ${event.time} ${event.kind.padEnd(8)} ${formatEventDetail(event)}`)
}

export function formatTuiEventRecord(record: ProjectEventRecord): string {
  return `${record.time} ${record.kind} ${formatEventDetail(record)}`
}

function formatEventDetail(record: ProjectEventRecord): string {
  if (record.kind === 'pipeline') {
    return `${record.event.type}${record.event.stage === undefined ? '' : ` ${record.event.stage}`}${formatPipelineProgress(record.event)}${record.event.message === undefined ? '' : ` ${record.event.message}`}`
  }

  return `${record.event.role} ${record.event.operation} ${record.event.status} ${record.event.durationMs}ms`
}

function formatPipelineProgress(event: Extract<ProjectEventRecord, {kind: 'pipeline'}>['event']): string {
  const parts = [
    ...(event.current === undefined ? [] : [`${event.current}`]),
    ...(event.total === undefined ? [] : [`/${event.total}`]),
    ...(event.percent === undefined ? [] : [` ${formatProgressPercent(event.percent)}%`]),
    ...(event.unit === undefined ? [] : [` ${event.unit}`]),
  ]

  return parts.length === 0 ? '' : ` ${parts.join('')}`
}

function formatProgressPercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1)
}
