import type {PipelineEvent, PipelineEventType} from '@video-agent/core'

import {resolve} from 'node:path'

import type {ProviderCallRecord, ProviderCallRole, ProviderCallStatus} from '../provider/call-record.js'

import {PIPELINE_EVENTS_LOG_ARTIFACT_NAME, PROVIDER_CALLS_LOG_ARTIFACT_NAME} from '../artifacts/log-artifact-names.js'
import {PipelineEventLogLineSchema, ProviderCallLogLineSchema} from '../artifacts/log-schemas.js'
import {readParsedJsonLines} from '../shared/file-io.js'

import {DEFAULT_WORKSPACE_DIR} from '../shared/defaults.js'
export const PROJECT_EVENT_KIND_PIPELINE = 'pipeline' as const
export const PROJECT_EVENT_KIND_PROVIDER = 'provider' as const

export const PROJECT_EVENT_KINDS = [PROJECT_EVENT_KIND_PIPELINE, PROJECT_EVENT_KIND_PROVIDER] as const

export type ProjectEventKind = (typeof PROJECT_EVENT_KINDS)[number]

export interface ReadProjectEventsOptions {
  kind?: ProjectEventKind
  limit?: number
  pipelineStage?: string
  pipelineType?: PipelineEventType
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
  kind: typeof PROJECT_EVENT_KIND_PIPELINE
  time: string
}

export interface ProviderProjectEventRecord {
  event: ProviderCallRecord
  kind: typeof PROJECT_EVENT_KIND_PROVIDER
  time: string
}

export async function readProjectEvents(projectId: string, options: ReadProjectEventsOptions = {}): Promise<ProjectEventsResult> {
  const workspaceDir = options.workspaceDir ?? DEFAULT_WORKSPACE_DIR
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const [pipelineEvents, providerCalls] = await Promise.all([
    options.kind === PROJECT_EVENT_KIND_PROVIDER ? Promise.resolve([]) : readParsedJsonLines(resolve(artifactsDir, PIPELINE_EVENTS_LOG_ARTIFACT_NAME), PipelineEventLogLineSchema),
    options.kind === PROJECT_EVENT_KIND_PIPELINE ? Promise.resolve([]) : readParsedJsonLines(resolve(artifactsDir, PROVIDER_CALLS_LOG_ARTIFACT_NAME), ProviderCallLogLineSchema),
  ])
  const events = [
    ...pipelineEvents.filter((event) => matchesPipelineFilter(event, options)).map((event): PipelineProjectEventRecord => ({event, kind: PROJECT_EVENT_KIND_PIPELINE, time: event.time})),
    ...providerCalls.filter((event) => matchesProviderFilter(event, options)).map((event): ProviderProjectEventRecord => ({event, kind: PROJECT_EVENT_KIND_PROVIDER, time: event.completedAt})),
  ]
    .sort((a, b) => a.time.localeCompare(b.time))

  return {
    events: applyEventLimit(events, options.limit),
    projectId,
  }
}

function applyEventLimit(events: ProjectEventRecord[], limit: number | undefined): ProjectEventRecord[] {
  if (limit === undefined) {
    return events
  }

  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`Project event limit must be a non-negative integer. Received: ${String(limit)}`)
  }

  if (limit === 0) {
    return []
  }

  return events.slice(-limit)
}

function matchesPipelineFilter(event: PipelineEvent, options: ReadProjectEventsOptions): boolean {
  return (options.pipelineStage === undefined || event.stage === options.pipelineStage) && (options.pipelineType === undefined || event.type === options.pipelineType)
}

function matchesProviderFilter(event: ProviderCallRecord, options: ReadProjectEventsOptions): boolean {
  return (options.providerRole === undefined || event.role === options.providerRole) && (options.providerStatus === undefined || event.status === options.providerStatus)
}
