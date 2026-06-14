import type {PipelineEvent} from '@video-agent/core'

import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import type {ProviderCallRecord, ProviderCallRole, ProviderCallStatus} from './provider-calls.js'

export type ProjectEventKind = 'pipeline' | 'provider'

export interface ReadProjectEventsOptions {
  kind?: ProjectEventKind
  limit?: number
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
    ...pipelineEvents.map((event): PipelineProjectEventRecord => ({event, kind: 'pipeline', time: event.time})),
    ...providerCalls.filter((event) => matchesProviderFilter(event, options)).map((event): ProviderProjectEventRecord => ({event, kind: 'provider', time: event.completedAt})),
  ]
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(options.limit === undefined ? 0 : -options.limit)

  return {
    events,
    projectId,
  }
}

function matchesProviderFilter(event: ProviderCallRecord, options: ReadProjectEventsOptions): boolean {
  return (options.providerRole === undefined || event.role === options.providerRole) && (options.providerStatus === undefined || event.status === options.providerStatus)
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  let text: string

  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }

  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}
