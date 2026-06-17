import type {PipelineEvent} from '@video-agent/core'
import type {ProviderCallRecord, ProviderCallStartRecord} from '@video-agent/runtime'

export const AGENT_RUN_STAGE_ORDER = ['ingest', 'understand', 'plan', 'script', 'voiceover', 'quality'] as const

export type AgentRunStageStatus = 'completed' | 'failed' | 'pending' | 'retrying' | 'running'
export type AgentRunProviderStatus = 'failed' | 'running' | 'succeeded'
export type AgentRunTranscriptLevel = 'error' | 'info' | 'success' | 'warn'

export interface AgentRunStageState {
  attempt?: number
  current?: number
  endedAt?: number
  maxAttempts?: number
  message?: string
  name: string
  percent?: number
  startedAt?: number
  status: AgentRunStageStatus
  step?: string
  total?: number
  unit?: string
}

export interface AgentRunProviderState {
  completedAt?: number
  durationMs?: number
  error?: string
  model?: string
  operation: string
  provider: string
  requestId: string
  role: string
  startedAt?: number
  status: AgentRunProviderStatus
}

export interface AgentRunTranscriptEntry {
  id: string
  level: AgentRunTranscriptLevel
  text: string
}

export interface AgentRunProgressState {
  artifactsWritten: number
  completedAt?: number
  currentStage?: string
  lastMessages: string[]
  projectId?: string
  providerCalls: AgentRunProviderState[]
  startedAt: number
  status: 'failed' | 'running' | 'succeeded'
  stages: AgentRunStageState[]
  transcript: AgentRunTranscriptEntry[]
  workspaceDir?: string
}

export interface AgentRunCompleteSummary {
  artifactCount: number
  projectDir: string
  projectId: string
  status: string
}

export function createAgentRunProgressState(now = Date.now()): AgentRunProgressState {
  return {
    artifactsWritten: 0,
    lastMessages: [],
    providerCalls: [],
    startedAt: now,
    status: 'running',
    stages: AGENT_RUN_STAGE_ORDER.map((name) => ({
      name,
      status: 'pending',
    })),
    transcript: [],
  }
}

export function applyPipelineEvent(state: AgentRunProgressState, event: PipelineEvent): AgentRunProgressState {
  const at = parseTime(event.time)
  let next: AgentRunProgressState = {
    ...state,
    projectId: event.projectId,
  }

  if (event.stage !== undefined) {
    next = ensureStage(next, event.stage)
  }

  if (event.type === 'stage:start' && event.stage !== undefined) {
    return updateStage(next, event.stage, (stage) => ({
      ...stage,
      attempt: event.attempt,
      current: undefined,
      endedAt: undefined,
      maxAttempts: event.maxAttempts,
      message: event.message,
      percent: undefined,
      startedAt: at,
      status: 'running',
      step: event.step,
      total: undefined,
      unit: event.unit,
    }), event.stage)
  }

  if (event.type === 'stage:progress' && event.stage !== undefined) {
    return updateStage(next, event.stage, (stage) => ({
      ...stage,
      attempt: event.attempt ?? stage.attempt,
      current: event.current,
      maxAttempts: event.maxAttempts ?? stage.maxAttempts,
      message: event.message ?? stage.message,
      percent: normalizePercent(event.percent, event.current, event.total),
      status: stage.status === 'completed' || stage.status === 'failed' ? stage.status : 'running',
      step: event.step ?? stage.step,
      total: event.total,
      unit: event.unit,
    }), event.stage)
  }

  if (event.type === 'stage:complete' && event.stage !== undefined) {
    next = updateStage(next, event.stage, (stage) => ({
      ...stage,
      endedAt: at,
      message: event.message ?? stage.message,
      percent: 100,
      status: 'completed',
      step: event.step ?? stage.step,
    }), event.stage)

    return appendTranscript(next, 'success', `${event.stage} completed${formatDurationSuffix(next, event.stage)}`)
  }

  if (event.type === 'stage:retry' && event.stage !== undefined) {
    next = updateStage(next, event.stage, (stage) => ({
      ...stage,
      attempt: event.attempt ?? stage.attempt,
      maxAttempts: event.maxAttempts ?? stage.maxAttempts,
      message: event.message ?? stage.message,
      status: 'retrying',
      step: event.step ?? stage.step,
    }), event.stage)

    return appendTranscript(next, 'warn', `${event.stage} retrying${formatAttempt(event)}${event.retryDelayMs === undefined ? '' : ` in ${formatDuration(event.retryDelayMs)}`}`)
  }

  if (event.type === 'stage:fail' && event.stage !== undefined) {
    next = updateStage(next, event.stage, (stage) => ({
      ...stage,
      endedAt: at,
      message: event.message ?? stage.message,
      status: 'failed',
      step: event.step ?? stage.step,
    }), event.stage)

    return appendTranscript({...next, status: 'failed'}, 'error', `${event.stage} failed${event.message === undefined ? '' : `: ${event.message}`}`)
  }

  if (event.type === 'artifact') {
    const artifactPath = event.artifact?.path

    return addMessage({
      ...next,
      artifactsWritten: next.artifactsWritten + 1,
    }, artifactPath === undefined ? 'artifact written' : `artifact ${artifactPath}`)
  }

  if (event.type === 'log') {
    const message = formatLogMessage(event)
    next = event.stage === undefined ? next : updateStage(next, event.stage, (stage) => ({
      ...stage,
      message: event.message ?? stage.message,
      step: event.step ?? stage.step,
    }), event.stage)

    return event.level === 'error' || event.level === 'warn'
      ? appendTranscript(addMessage(next, message), event.level === 'error' ? 'error' : 'warn', message)
      : addMessage(next, message)
  }

  return next
}

export function applyProviderCallStart(state: AgentRunProgressState, call: ProviderCallStartRecord): AgentRunProgressState {
  const providerCall = {
    operation: call.operation,
    provider: call.provider,
    requestId: call.requestId,
    role: call.role,
    startedAt: parseTime(call.startedAt),
    status: 'running' as const,
  }

  return upsertProviderCall(state, providerCall)
}

export function applyProviderCall(state: AgentRunProgressState, call: ProviderCallRecord): AgentRunProgressState {
  const providerCall = {
    completedAt: parseTime(call.completedAt),
    durationMs: call.durationMs,
    error: call.error?.message,
    model: call.model,
    operation: call.operation,
    provider: call.provider,
    requestId: call.requestId,
    role: call.role,
    startedAt: parseTime(call.startedAt),
    status: call.status,
  }

  const next = upsertProviderCall(state, providerCall)
  const message = `${call.role} ${call.provider} ${call.operation} ${call.status}${call.durationMs === undefined ? '' : ` ${formatDuration(call.durationMs)}`}`

  return call.status === 'failed'
    ? appendTranscript(addMessage(next, message), 'error', `${message}${call.error === undefined ? '' : `: ${call.error.message}`}`)
    : addMessage(next, message)
}

export function completeAgentRunProgressState(state: AgentRunProgressState, summary: AgentRunCompleteSummary, now = Date.now()): AgentRunProgressState {
  return appendTranscript({
    ...state,
    completedAt: now,
    projectId: summary.projectId,
    status: summary.status === 'completed' ? 'succeeded' : 'failed',
    workspaceDir: summary.projectDir,
  }, summary.status === 'completed' ? 'success' : 'warn', `run ${summary.status} project=${summary.projectId} artifacts=${summary.artifactCount}`)
}

export function failAgentRunProgressState(state: AgentRunProgressState, error: unknown, now = Date.now()): AgentRunProgressState {
  return appendTranscript({
    ...state,
    completedAt: now,
    status: 'failed',
  }, 'error', `run failed: ${formatError(error)}`)
}

export function getCurrentStage(state: AgentRunProgressState): AgentRunStageState | undefined {
  const active = state.stages.find((stage) => stage.status === 'running' || stage.status === 'retrying')

  if (active !== undefined) {
    return active
  }

  return state.stages.find((stage) => stage.status === 'pending') ?? state.stages.at(-1)
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60

  if (minutes === 0) {
    return `${remainder}s`
  }

  const hours = Math.floor(minutes / 60)
  const minuteRemainder = minutes % 60

  if (hours === 0) {
    return `${minutes}m ${remainder}s`
  }

  return `${hours}h ${minuteRemainder}m`
}

function ensureStage(state: AgentRunProgressState, name: string): AgentRunProgressState {
  if (state.stages.some((stage) => stage.name === name)) {
    return state
  }

  return {
    ...state,
    stages: [
      ...state.stages,
      {
        name,
        status: 'pending',
      },
    ],
  }
}

function updateStage(state: AgentRunProgressState, name: string, update: (stage: AgentRunStageState) => AgentRunStageState, currentStage = state.currentStage): AgentRunProgressState {
  return {
    ...state,
    currentStage,
    stages: state.stages.map((stage) => stage.name === name ? update(stage) : stage),
  }
}

function upsertProviderCall(state: AgentRunProgressState, call: AgentRunProviderState): AgentRunProgressState {
  const existing = state.providerCalls.filter((providerCall) => providerCall.requestId !== call.requestId)

  return {
    ...state,
    providerCalls: [
      call,
      ...existing,
    ].slice(0, 8),
  }
}

function appendTranscript(state: AgentRunProgressState, level: AgentRunTranscriptLevel, text: string): AgentRunProgressState {
  return {
    ...state,
    transcript: [
      ...state.transcript,
      {
        id: `${state.transcript.length + 1}`,
        level,
        text,
      },
    ],
  }
}

function addMessage(state: AgentRunProgressState, message: string): AgentRunProgressState {
  return {
    ...state,
    lastMessages: [
      message,
      ...state.lastMessages.filter((entry) => entry !== message),
    ].slice(0, 5),
  }
}

function normalizePercent(percent: number | undefined, current: number | undefined, total: number | undefined): number | undefined {
  if (percent !== undefined) {
    return Math.max(0, Math.min(100, percent))
  }

  if (current === undefined || total === undefined || total <= 0) {
    return undefined
  }

  return Math.max(0, Math.min(100, (current / total) * 100))
}

function parseTime(time: string): number {
  const parsed = Date.parse(time)

  return Number.isNaN(parsed) ? Date.now() : parsed
}

function formatDurationSuffix(state: AgentRunProgressState, stageName: string): string {
  const stage = state.stages.find((candidate) => candidate.name === stageName)

  if (stage?.startedAt === undefined || stage.endedAt === undefined) {
    return ''
  }

  return ` in ${formatDuration(stage.endedAt - stage.startedAt)}`
}

function formatAttempt(event: PipelineEvent): string {
  if (event.attempt === undefined) {
    return ''
  }

  return event.maxAttempts === undefined ? ` attempt ${event.attempt}` : ` attempt ${event.attempt}/${event.maxAttempts}`
}

function formatLogMessage(event: PipelineEvent): string {
  const stage = event.stage === undefined ? 'pipeline' : event.stage
  const step = event.step === undefined ? '' : `.${event.step}`
  const message = event.message === undefined ? '' : ` ${event.message}`

  return `${stage}${step}${message}`.trim()
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
