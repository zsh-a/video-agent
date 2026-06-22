import type {AgentRunSnapshot, AgentStepSnapshot, AgentStepStatus} from '@video-agent/core'

import {
  AGENT_STATUS_COMPLETED,
  AGENT_STATUS_FAILED,
  AGENT_STATUS_RUNNING,
  PIPELINE_EVENT_AGENT_RUN_COMPLETE,
  PIPELINE_EVENT_AGENT_RUN_FAIL,
  PIPELINE_EVENT_AGENT_RUN_START,
  PIPELINE_EVENT_AGENT_STEP_COMPLETE,
  PIPELINE_EVENT_AGENT_STEP_FAIL,
  PIPELINE_EVENT_AGENT_STEP_PROGRESS,
  PIPELINE_EVENT_AGENT_STEP_START,
  type PipelineEventType,
} from '@video-agent/core'
import {resolve} from 'node:path'

import type {PipelineEventLike} from './event-summary.js'

import {PipelineEventLogLineSchema} from '../artifacts/log-schemas.js'
import {PIPELINE_EVENTS_LOG_ARTIFACT_NAME} from '../artifacts/log-artifact-names.js'
import {DEFAULT_WORKSPACE_DIR} from '../shared/defaults.js'
import {readParsedJsonLines} from '../shared/file-io.js'

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

export async function readProjectAgentStatus(projectId: string, workspaceDir = DEFAULT_WORKSPACE_DIR): Promise<ProjectAgentStatus> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const events = await readParsedJsonLines(resolve(artifactsDir, PIPELINE_EVENTS_LOG_ARTIFACT_NAME), PipelineEventLogLineSchema)

  return summarizeAgentEvents(events)
}

export function summarizeAgentEvents(events: AgentEventLike[]): ProjectAgentStatus {
  const runs = new Map<string, AgentRunSnapshot>()
  const stepIndex = new Map<string, AgentStepSnapshot>()

  for (const event of events) {
    if (!isAgentEventType(event.type)) {
      continue
    }

    const runId = requireCleanString(event.agentRunId, `${event.type}.agentRunId`)
    const time = requireCleanString(event.time, `${event.type}.time`)
    const run = requireRun(runs, runId, time)

    if (event.type === PIPELINE_EVENT_AGENT_RUN_START) {
      run.status = AGENT_STATUS_RUNNING
      run.startedAt = time
      run.message = readOptionalCleanString(event.message, `${event.type}.message`)
      continue
    }

    if (event.type === PIPELINE_EVENT_AGENT_RUN_COMPLETE) {
      run.status = AGENT_STATUS_COMPLETED
      run.completedAt = time
      run.message = readOptionalCleanString(event.message, `${event.type}.message`)
      continue
    }

    if (event.type === PIPELINE_EVENT_AGENT_RUN_FAIL) {
      run.status = AGENT_STATUS_FAILED
      run.failedAt = time
      run.message = readOptionalCleanString(event.message, `${event.type}.message`)
      continue
    }

    const step = requireStep(stepIndex, run, event)

    if (event.type === PIPELINE_EVENT_AGENT_STEP_START) {
      applyStepEvent(step, event, AGENT_STATUS_RUNNING)
      step.startedAt = time
      continue
    }

    if (event.type === PIPELINE_EVENT_AGENT_STEP_PROGRESS) {
      applyStepEvent(step, event, AGENT_STATUS_RUNNING)
      continue
    }

    if (event.type === PIPELINE_EVENT_AGENT_STEP_COMPLETE) {
      applyStepEvent(step, event, AGENT_STATUS_COMPLETED)
      step.completedAt = time
      step.durationMs = requireNonNegativeNumber(event.durationMs, `${event.type}.durationMs`)
      continue
    }

    if (event.type === PIPELINE_EVENT_AGENT_STEP_FAIL) {
      applyStepEvent(step, event, AGENT_STATUS_FAILED)
      step.failedAt = time
      step.durationMs = requireNonNegativeNumber(event.durationMs, `${event.type}.durationMs`)
    }
  }

  const orderedRuns = Array.from(runs.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt))

  return {
    currentRun: findLastRun(orderedRuns, AGENT_STATUS_RUNNING) ?? orderedRuns.at(-1),
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
    status: AGENT_STATUS_RUNNING,
    steps: [],
  }

  runs.set(runId, run)

  return run
}

function requireStep(stepIndex: Map<string, AgentStepSnapshot>, run: AgentRunSnapshot, event: AgentEventLike): AgentStepSnapshot {
  const eventType = requireAgentStepEventType(event.type)
  const stepId = requireCleanString(event.agentStepId, `${eventType}.agentStepId`)
  const existing = stepIndex.get(stepId)

  if (existing !== undefined) {
    return existing
  }

  const step: AgentStepSnapshot = {
    name: requireCleanString(event.step, `${eventType}.step`),
    startedAt: requireCleanString(event.time, `${eventType}.time`),
    stage: requireCleanString(event.stage, `${eventType}.stage`),
    status: AGENT_STATUS_RUNNING,
  }

  stepIndex.set(stepId, step)
  run.steps.push(step)

  return step
}

function applyStepEvent(step: AgentStepSnapshot, event: AgentEventLike, status: AgentStepStatus): void {
  const eventType = requireAgentStepEventType(event.type)

  step.status = status
  step.current = readOptionalNonNegativeNumber(event.current, `${eventType}.current`) ?? step.current
  step.message = readOptionalCleanString(event.message, `${eventType}.message`) ?? step.message
  step.name = readOptionalCleanString(event.step, `${eventType}.step`) ?? step.name
  step.percent = readOptionalNonNegativeNumber(event.percent, `${eventType}.percent`) ?? step.percent
  step.stage = readOptionalCleanString(event.stage, `${eventType}.stage`) ?? step.stage
  step.total = readOptionalNonNegativeNumber(event.total, `${eventType}.total`) ?? step.total
  step.unit = readOptionalUnit(event.unit, `${eventType}.unit`) ?? step.unit
}

function isAgentEventType(type: unknown): type is PipelineEventType {
  return isAgentRunEventType(type) || isAgentStepEventType(type)
}

function isAgentRunEventType(type: unknown): type is typeof PIPELINE_EVENT_AGENT_RUN_COMPLETE | typeof PIPELINE_EVENT_AGENT_RUN_FAIL | typeof PIPELINE_EVENT_AGENT_RUN_START {
  return type === PIPELINE_EVENT_AGENT_RUN_COMPLETE || type === PIPELINE_EVENT_AGENT_RUN_FAIL || type === PIPELINE_EVENT_AGENT_RUN_START
}

function isAgentStepEventType(type: unknown): type is typeof PIPELINE_EVENT_AGENT_STEP_COMPLETE | typeof PIPELINE_EVENT_AGENT_STEP_FAIL | typeof PIPELINE_EVENT_AGENT_STEP_PROGRESS | typeof PIPELINE_EVENT_AGENT_STEP_START {
  return type === PIPELINE_EVENT_AGENT_STEP_COMPLETE || type === PIPELINE_EVENT_AGENT_STEP_FAIL || type === PIPELINE_EVENT_AGENT_STEP_PROGRESS || type === PIPELINE_EVENT_AGENT_STEP_START
}

function requireAgentStepEventType(type: unknown): typeof PIPELINE_EVENT_AGENT_STEP_COMPLETE | typeof PIPELINE_EVENT_AGENT_STEP_FAIL | typeof PIPELINE_EVENT_AGENT_STEP_PROGRESS | typeof PIPELINE_EVENT_AGENT_STEP_START {
  if (!isAgentStepEventType(type)) {
    throw new Error(`Agent step status requires an agent step event type; no agent event type fallback is allowed. Received: ${String(type)}`)
  }

  return type
}

function requireCleanString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) {
    throw new Error(`Agent status event field ${field} must be clean non-empty text; no agent status fallback is allowed.`)
  }

  return value
}

function readOptionalCleanString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return requireCleanString(value, field)
}

function requireNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Agent status event field ${field} must be a finite non-negative number; no agent status timing fallback is allowed.`)
  }

  return value
}

function readOptionalNonNegativeNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  return requireNonNegativeNumber(value, field)
}

function readOptionalUnit(value: unknown, field: string): AgentStepSnapshot['unit'] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === 'chunks' || value === 'files' || value === 'frames' || value === 'scenes' || value === 'seconds' || value === 'segments' || value === 'tokens') {
    return value
  }

  throw new Error(`Agent status event field ${field} must be a supported progress unit; no agent status unit fallback is allowed.`)
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
