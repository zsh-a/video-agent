export type PipelineKind = 'deck' | 'film'
export type PipelineStage = string

export interface PipelineDefinition<K extends PipelineKind = PipelineKind, S extends string = PipelineStage> {
  checkpointArtifactsByStage: Partial<Record<S, readonly string[]>>
  defaultRerunStage: S
  kind: K
  stages: readonly S[]
}

export function detectPipelineKind(job: {pipeline?: string}): PipelineKind {
  if (job.pipeline === 'deck' || job.pipeline === 'film') {
    return job.pipeline
  }

  throw new Error('Cannot determine project pipeline kind from job-state.json.')
}

export function isPipelineStage<S extends string>(definition: PipelineDefinition<PipelineKind, S>, value: string | undefined): value is S {
  return value !== undefined && definition.stages.includes(value as S)
}

export function assertPipelineStage<S extends string>(definition: PipelineDefinition<PipelineKind, S>, value: string): S {
  if (isPipelineStage(definition, value)) {
    return value
  }

  throw new Error(`Unknown ${definition.kind} pipeline stage: ${value}`)
}
