import type {PipelineEvent} from '@video-agent/core'

import {resolve} from 'node:path'

import type {ProviderCallRecord, ProviderCallRole, ProviderCallStatus} from '../provider/calls.js'

import {readJsonLines} from '../shared/file-io.js'

export type ProjectEventKind = 'pipeline' | 'provider'
export type ProjectPipelineEventType = PipelineEvent['type']

export interface ReadProjectEventsOptions {
  kind?: ProjectEventKind
  limit?: number
  pipelineStage?: string
  pipelineType?: ProjectPipelineEventType
  providerRole?: ProviderCallRole
  providerStatus?: ProviderCallStatus
  workspaceDir?: string
}

export interface ProjectEventsResult {
  events: ProjectEventRecord[]
  projectId: string
}

export type ProjectEventRecord = PipelineProjectEventRecord | ProviderProjectEventRecord

export interface PipelineProjectEventRecord {
  event: PipelineEvent
  kind: 'pipeline'
  time: string
}

export interface ProviderProjectEventRecord {
  event: ProviderCallRecord
  kind: 'provider'
  time: string
}

export async function readProjectEvents(projectId: string, options: ReadProjectEventsOptions = {}): Promise<ProjectEventsResult> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const [pipelineEvents, providerCalls] = await Promise.all([
    options.kind === 'provider' ? Promise.resolve([]) : readJsonLines<PipelineEvent>(resolve(artifactsDir, 'pipeline-events.jsonl')),
    options.kind === 'pipeline' ? Promise.resolve([]) : readJsonLines<ProviderCallRecord>(resolve(artifactsDir, 'provider-calls.jsonl')),
  ])
  const events = [
    ...pipelineEvents.filter((event) => matchesPipelineFilter(event, options)).map((event): PipelineProjectEventRecord => ({event, kind: 'pipeline', time: event.time})),
    ...providerCalls.filter((event) => matchesProviderFilter(event, options)).map((event): ProviderProjectEventRecord => ({event, kind: 'provider', time: event.completedAt})),
  ]
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(options.limit === undefined ? 0 : -options.limit)

  return {
    events,
    projectId,
  }
}

function matchesPipelineFilter(event: PipelineEvent, options: ReadProjectEventsOptions): boolean {
  return (options.pipelineStage === undefined || event.stage === options.pipelineStage) && (options.pipelineType === undefined || event.type === options.pipelineType)
}

function matchesProviderFilter(event: ProviderCallRecord, options: ReadProjectEventsOptions): boolean {
  return (options.providerRole === undefined || event.role === options.providerRole) && (options.providerStatus === undefined || event.status === options.providerStatus)
}
