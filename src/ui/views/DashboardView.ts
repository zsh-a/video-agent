import type {ReactElement} from 'react'

import {PROJECT_EVENT_KIND_PROVIDER} from '@video-agent/runtime'
import {Box, Text} from 'ink'
import {createElement as h} from 'react'

import type {TuiSnapshot} from '../model.js'

import {Badge} from '../components/Badge.js'
import {EmptyTable, Table} from '../components/Table.js'
import {formatBytes, formatEvent, formatRender} from '../format/common.js'
import {statusColor, statusSymbol, symbols} from '../theme.js'
import {EmptyView, Field, SectionHeading} from './common.js'

type DashboardArtifact = TuiSnapshot['artifacts'][number]
type DashboardEvent = TuiSnapshot['events'][number]
type DashboardStage = NonNullable<TuiSnapshot['selected']>['job']['stages'][number]

export function DashboardView({snapshot}: {snapshot?: TuiSnapshot}): ReactElement {
  const selected = snapshot?.selected

  if (selected === undefined) {
    return h(EmptyView, {message: 'No focused project.'})
  }

  const artifacts = snapshot?.artifacts ?? []
  const events = snapshot?.events ?? []
  const providerEvents = events.filter((event) => event.kind === PROJECT_EVENT_KIND_PROVIDER)
  const latestEvent = events.at(-1)
  const currentAgentRun = selected.agent?.currentRun
  const agentSteps = currentAgentRun?.steps ?? []

  return h(Box, {flexDirection: 'column'},
    h(Box, {gap: 2},
      h(Field, {label: 'project', value: selected.projectId}),
      h(Field, {label: 'status', value: h(Badge, {status: selected.job.status})}),
      h(Field, {label: 'quality', value: `${selected.summary.quality.issues} issues`}),
      h(Field, {label: 'render', value: formatRender(selected.summary.render)}),
    ),
    h(Field, {label: 'input', value: selected.job.inputPath}),
    h(SectionHeading, null, 'Pipeline'),
    Table<DashboardStage>({
      columns: [
        {header: '', key: 'mark', render: (stage) => statusSymbol(stage.status), width: 2, color: (stage) => statusColor(stage.status)},
        {header: 'Stage', key: 'stage', render: (stage) => stage.name, width: 18, color: (stage) => statusColor(stage.status)},
        {header: 'Status', key: 'status', render: (stage) => stage.status, width: 10, color: (stage) => statusColor(stage.status)},
        {header: 'Detail', key: 'detail', render: (stage) => formatStageDetail(stage), width: 42},
      ],
      data: selected.job.stages,
      header: false,
      maxRows: 10,
      rowKey: (stage) => stage.name,
    }),
    h(SectionHeading, null, 'Agent'),
    currentAgentRun === undefined ? h(EmptyTable, {message: 'none'}) : Table<(typeof agentSteps)[number]>({
      columns: [
        {header: '', key: 'mark', render: (step) => statusSymbol(step.status), width: 2, color: (step) => statusColor(step.status)},
        {header: 'Step', key: 'step', render: (step) => step.name, width: 24, color: (step) => statusColor(step.status)},
        {header: 'Stage', key: 'stage', render: (step) => step.stage ?? '', width: 14},
        {header: 'Progress', key: 'progress', render: (step) => formatProgress(step), width: 16},
      ],
      data: agentSteps,
      header: false,
      maxRows: 5,
      rowKey: (step, index) => `${step.startedAt}:${index}`,
    }),
    h(SectionHeading, null, 'Providers'),
    providerEvents.length === 0 ? h(EmptyTable, {message: 'none'}) : Table<DashboardEvent>({
      columns: [
        {header: '', key: 'mark', render: (event) => event.kind === PROJECT_EVENT_KIND_PROVIDER ? providerSymbol(event.event.status) : symbols.info, width: 2},
        {header: 'Role', key: 'role', render: (event) => event.kind === PROJECT_EVENT_KIND_PROVIDER ? `${event.event.role}/${event.event.provider}` : 'pipeline', width: 18},
        {header: 'Op', key: 'operation', render: (event) => event.kind === PROJECT_EVENT_KIND_PROVIDER ? event.event.operation : event.event.type, width: 16},
        {header: 'Status', key: 'status', render: (event) => event.kind === PROJECT_EVENT_KIND_PROVIDER ? event.event.status : event.event.type, width: 10, color: (event) => event.kind === PROJECT_EVENT_KIND_PROVIDER ? statusColor(event.event.status) : undefined},
        {align: 'right', header: 'Time', key: 'duration', render: (event) => event.kind === PROJECT_EVENT_KIND_PROVIDER ? `${event.event.durationMs}ms` : '', width: 8},
      ],
      data: providerEvents,
      header: false,
      maxRows: 3,
      rowKey: (event, index) => `${event.time}:${index}`,
    }),
    h(SectionHeading, null, `Artifacts ${artifacts.length}`),
    artifacts.length === 0 ? h(EmptyTable, {message: 'none'}) : Table<DashboardArtifact>({
      columns: [
        {header: 'Name', key: 'name', render: (artifact) => artifact.name, width: 34},
        {header: 'Kind', key: 'kind', render: (artifact) => artifact.kind, width: 5},
        {align: 'right', header: 'Size', key: 'size', render: (artifact) => formatBytes(artifact.size), width: 9},
      ],
      data: artifacts,
      header: false,
      maxRows: 3,
      rowKey: (artifact) => artifact.name,
    }),
    h(SectionHeading, null, 'Latest Event'),
    latestEvent === undefined ? h(Text, {dimColor: true}, 'none') : h(Text, {wrap: 'truncate-end'}, formatEvent(latestEvent)),
  )
}

function formatProgress(progress: {current?: number; percent?: number; total?: number; unit?: string}): string {
  if (progress.percent !== undefined) {
    return `${Math.round(progress.percent)}%`
  }

  if (progress.current !== undefined && progress.total !== undefined) {
    return `${progress.current}/${progress.total}${progress.unit === undefined ? '' : ` ${progress.unit}`}`
  }

  return ''
}

function formatStageDetail(stage: NonNullable<TuiSnapshot['selected']>['job']['stages'][number]): string {
  const parts = [
    stage.attempt === undefined ? undefined : `attempt ${stage.attempt}`,
    stage.message,
  ].filter((part): part is string => part !== undefined && part !== '')

  return parts.join(' ')
}

function providerSymbol(status: string): string {
  if (status === 'succeeded') {
    return symbols.info
  }

  if (status === 'failed') {
    return symbols.failure
  }

  return symbols.running
}
