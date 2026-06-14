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
  maxAttempts?: number
  message?: string
  projectId: string
  retryDelayMs?: number
  stage?: StageName | string
  time: string
  type: 'artifact' | 'log' | 'stage:complete' | 'stage:fail' | 'stage:retry' | 'stage:start'
}

export interface Stage<I, O> {
  name: StageName | string
  run(input: I, ctx: PipelineContext): Promise<O>
}
