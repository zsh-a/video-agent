import type {AgentRunSnapshot, AgentStepSnapshot, AgentStepStatus} from '@video-agent/core'

import {resolve} from 'node:path'

import type {PipelineEventLike} from './event-summary.js'

import {readJsonLines} from '../shared/file-io.js'

export interface ProjectAgentStatus {
  currentRun?: AgentRunSnapshot
  runs: AgentRunSnapshot[]
}

interface AgentEventLike extends PipelineEventLike {
  agentRunId?: unknown
  agentStepId?: unknown
  current?: unknown
  durationMs?: unknown
  message?: unknown
  percent?: unknown
  stage?: unknown
  step?: unknown
  total?: unknown
  unit?: unknown
}

export async function readProjectAgentStatus(projectId: string, workspaceDir = '.video-agent'): Promise<ProjectAgentStatus> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const events = await readJsonLines<AgentEventLike>(resolve(artifactsDir, 'pipeline-events.jsonl'))

  return summarizeAgentEvents(events)
}

export function summarizeAgentEvents(events: AgentEventLike[]): ProjectAgentStatus {
  const runs = new Map<string, AgentRunSnapshot>()
  const stepIndex = new Map<string, AgentStepSnapshot>()

  for (const event of events) {
    if (typeof event.agentRunId !== 'string' || typeof event.type !== 'string' || typeof event.time !== 'string') {
      continue
    }

    const run = requireRun(runs, event.agentRunId, event.time)

    if (event.type === 'agent:run:start') {
      run.status = 'running'
      run.startedAt = event.time
      run.message = readString(event.message)
      continue
    }

    if (event.type === 'agent:run:complete') {
      run.status = 'completed'
      run.completedAt = event.time
      run.message = readString(event.message)
      continue
    }

    if (event.type === 'agent:run:fail') {
      run.status = 'failed'
      run.failedAt = event.time
      run.message = readString(event.message)
      continue
    }

    if (typeof event.agentStepId !== 'string') {
      continue
    }

    const step = requireStep(stepIndex, run, event)

    if (event.type === 'agent:step:start') {
      applyStepEvent(step, event, 'running')
      step.startedAt = event.time
      continue
    }

    if (event.type === 'agent:step:progress') {
      applyStepEvent(step, event, 'running')
      continue
    }

    if (event.type === 'agent:step:complete') {
      applyStepEvent(step, event, 'completed')
      step.completedAt = event.time
      step.durationMs = readNumber(event.durationMs)
      continue
    }

    if (event.type === 'agent:step:fail') {
      applyStepEvent(step, event, 'failed')
      step.failedAt = event.time
      step.durationMs = readNumber(event.durationMs)
    }
  }

  const orderedRuns = Array.from(runs.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt))

  return {
    currentRun: findLastRun(orderedRuns, 'running') ?? orderedRuns.at(-1),
    runs: orderedRuns,
  }
}

function requireRun(runs: Map<string, AgentRunSnapshot>, runId: string, time: string): AgentRunSnapshot {
  const existing = runs.get(runId)

  if (existing !== undefined) {
    return existing
  }

  const run: AgentRunSnapshot = {
    runId,
    startedAt: time,
    status: 'running',
    steps: [],
  }

  runs.set(runId, run)

  return run
}

function requireStep(stepIndex: Map<string, AgentStepSnapshot>, run: AgentRunSnapshot, event: AgentEventLike): AgentStepSnapshot {
  const stepId = String(event.agentStepId)
  const existing = stepIndex.get(stepId)

  if (existing !== undefined) {
    return existing
  }

  const step: AgentStepSnapshot = {
    name: readString(event.step) ?? stepId,
    startedAt: readString(event.time) ?? new Date(0).toISOString(),
    stage: readString(event.stage),
    status: 'running',
  }

  stepIndex.set(stepId, step)
  run.steps.push(step)

  return step
}

function applyStepEvent(step: AgentStepSnapshot, event: AgentEventLike, status: AgentStepStatus): void {
  step.status = status
  step.current = readNumber(event.current) ?? step.current
  step.message = readString(event.message) ?? step.message
  step.name = readString(event.step) ?? step.name
  step.percent = readNumber(event.percent) ?? step.percent
  step.stage = readString(event.stage) ?? step.stage
  step.total = readNumber(event.total) ?? step.total
  step.unit = readUnit(event.unit) ?? step.unit
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readUnit(value: unknown): AgentStepSnapshot['unit'] | undefined {
  return value === 'chunks' || value === 'files' || value === 'frames' || value === 'scenes' || value === 'seconds' || value === 'segments' || value === 'tokens'
    ? value
    : undefined
}

function findLastRun(runs: AgentRunSnapshot[], status: AgentRunSnapshot['status']): AgentRunSnapshot | undefined {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index]

    if (run?.status === status) {
      return run
    }
  }

  return undefined
}
