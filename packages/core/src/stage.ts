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
  artifact?: ArtifactRef
  attempt?: number
  current?: number
  data?: Record<string, unknown>
  level?: 'debug' | 'error' | 'info' | 'warn'
  maxAttempts?: number
  message?: string
  percent?: number
  projectId: string
  retryDelayMs?: number
  stage?: StageName | string
  step?: string
  time: string
  total?: number
  type: 'artifact' | 'log' | 'stage:complete' | 'stage:fail' | 'stage:progress' | 'stage:retry' | 'stage:start'
  unit?: ProgressUnit
}

export interface Stage<I, O> {
  name: StageName | string
  run(input: I, ctx: PipelineContext): Promise<O>
}

export type ProgressUnit = 'chunks' | 'files' | 'frames' | 'scenes' | 'seconds' | 'segments' | 'tokens'
