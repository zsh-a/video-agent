import type {ArtifactRef, StageName} from '@video-agent/ir'

export interface PipelineContext {
  artifactsDir: string
  emit(event: PipelineEvent): Promise<void> | void
  projectId: string
  workspaceDir: string
}

export interface PipelineEvent {
  artifact?: ArtifactRef
  message?: string
  projectId: string
  stage?: StageName | string
  time: string
  type: 'artifact' | 'log' | 'stage:complete' | 'stage:fail' | 'stage:start'
}

export interface Stage<I, O> {
  name: StageName | string
  run(input: I, ctx: PipelineContext): Promise<O>
}
