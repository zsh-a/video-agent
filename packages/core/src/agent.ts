import type {ProgressUnit} from './stage.js'

export const AGENT_STATUS_COMPLETED = 'completed' as const
export const AGENT_STATUS_FAILED = 'failed' as const
export const AGENT_STATUS_RUNNING = 'running' as const

export const AGENT_RUN_STATUSES = [AGENT_STATUS_COMPLETED, AGENT_STATUS_FAILED, AGENT_STATUS_RUNNING] as const
export const AGENT_STEP_STATUSES = AGENT_RUN_STATUSES

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number]
export type AgentStepStatus = (typeof AGENT_STEP_STATUSES)[number]

export interface AgentProgress {
  current?: number
  message?: string
  percent?: number
  total?: number
  unit?: ProgressUnit
}

export interface AgentStepSnapshot extends AgentProgress {
  completedAt?: string
  durationMs?: number
  failedAt?: string
  message?: string
  name: string
  startedAt: string
  stage?: string
  status: AgentStepStatus
}

export interface AgentRunSnapshot {
  completedAt?: string
  failedAt?: string
  message?: string
  runId: string
  startedAt: string
  status: AgentRunStatus
  steps: AgentStepSnapshot[]
}
