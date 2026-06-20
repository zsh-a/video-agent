import type {ArtifactRef, StageName} from '@video-agent/ir'

export interface PipelineContext {
  artifactsDir: string
  emit(event: PipelineEvent): Promise<void> | void
  projectId: string
  retryPolicy?: PipelineRetryPolicy
  workspaceDir: string
}

export interface PipelineRetryPolicy {
  backoffMs?: number
  maxRetries: number
}

export interface PipelineEvent {
  agentRunId?: string
  agentStepId?: string
  artifact?: ArtifactRef
  attempt?: number
  current?: number
  data?: Record<string, unknown>
  durationMs?: number
  level?: 'debug' | 'error' | 'info' | 'warn'
  maxAttempts?: number
  message?: string
  parentStepId?: string
  percent?: number
  projectId: string
  retryDelayMs?: number
  stage?: StageName | string
  step?: string
  time: string
  toolCallId?: string
  total?: number
  type: PipelineEventType
  unit?: ProgressUnit
}

export interface Stage<I, O> {
  name: StageName | string
  run(input: I, ctx: PipelineContext): Promise<O>
}

export type ProgressUnit = 'chunks' | 'files' | 'frames' | 'scenes' | 'seconds' | 'segments' | 'tokens'

export type PipelineEventType =
  | 'agent:run:complete'
  | 'agent:run:fail'
  | 'agent:run:start'
  | 'agent:step:complete'
  | 'agent:step:fail'
  | 'agent:step:progress'
  | 'agent:step:start'
  | 'artifact'
  | 'log'
  | 'stage:complete'
  | 'stage:fail'
  | 'stage:progress'
  | 'stage:retry'
  | 'stage:start'
  | 'tool:call:complete'
  | 'tool:call:fail'
  | 'tool:call:start'
