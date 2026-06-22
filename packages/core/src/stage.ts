import type {ArtifactRef, StageName} from '@video-agent/ir'

export const PIPELINE_EVENT_AGENT_RUN_COMPLETE = 'agent:run:complete' as const
export const PIPELINE_EVENT_AGENT_RUN_FAIL = 'agent:run:fail' as const
export const PIPELINE_EVENT_AGENT_RUN_START = 'agent:run:start' as const
export const PIPELINE_EVENT_AGENT_STEP_COMPLETE = 'agent:step:complete' as const
export const PIPELINE_EVENT_AGENT_STEP_FAIL = 'agent:step:fail' as const
export const PIPELINE_EVENT_AGENT_STEP_PROGRESS = 'agent:step:progress' as const
export const PIPELINE_EVENT_AGENT_STEP_START = 'agent:step:start' as const
export const PIPELINE_EVENT_ARTIFACT = 'artifact' as const
export const PIPELINE_EVENT_LOG = 'log' as const
export const PIPELINE_EVENT_STAGE_COMPLETE = 'stage:complete' as const
export const PIPELINE_EVENT_STAGE_FAIL = 'stage:fail' as const
export const PIPELINE_EVENT_STAGE_PROGRESS = 'stage:progress' as const
export const PIPELINE_EVENT_STAGE_RETRY = 'stage:retry' as const
export const PIPELINE_EVENT_STAGE_SKIP = 'stage:skip' as const
export const PIPELINE_EVENT_STAGE_START = 'stage:start' as const
export const PIPELINE_EVENT_TOOL_CALL_COMPLETE = 'tool:call:complete' as const
export const PIPELINE_EVENT_TOOL_CALL_FAIL = 'tool:call:fail' as const
export const PIPELINE_EVENT_TOOL_CALL_START = 'tool:call:start' as const

export const PIPELINE_EVENT_TYPES = [
  PIPELINE_EVENT_AGENT_RUN_COMPLETE,
  PIPELINE_EVENT_AGENT_RUN_FAIL,
  PIPELINE_EVENT_AGENT_RUN_START,
  PIPELINE_EVENT_AGENT_STEP_COMPLETE,
  PIPELINE_EVENT_AGENT_STEP_FAIL,
  PIPELINE_EVENT_AGENT_STEP_PROGRESS,
  PIPELINE_EVENT_AGENT_STEP_START,
  PIPELINE_EVENT_ARTIFACT,
  PIPELINE_EVENT_LOG,
  PIPELINE_EVENT_STAGE_COMPLETE,
  PIPELINE_EVENT_STAGE_FAIL,
  PIPELINE_EVENT_STAGE_PROGRESS,
  PIPELINE_EVENT_STAGE_RETRY,
  PIPELINE_EVENT_STAGE_SKIP,
  PIPELINE_EVENT_STAGE_START,
  PIPELINE_EVENT_TOOL_CALL_COMPLETE,
  PIPELINE_EVENT_TOOL_CALL_FAIL,
  PIPELINE_EVENT_TOOL_CALL_START,
] as const

export const PROGRESS_UNITS = ['chunks', 'files', 'frames', 'scenes', 'seconds', 'segments', 'tokens'] as const

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

export type ProgressUnit = (typeof PROGRESS_UNITS)[number]

export type PipelineEventType = (typeof PIPELINE_EVENT_TYPES)[number]
