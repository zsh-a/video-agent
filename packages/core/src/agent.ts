import type {ProgressUnit} from './stage.js'

export type AgentRunStatus = 'completed' | 'failed' | 'running'
export type AgentStepStatus = 'completed' | 'failed' | 'running'

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
