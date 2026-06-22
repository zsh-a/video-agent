import {
  PIPELINE_EVENT_STAGE_COMPLETE,
  PIPELINE_EVENT_STAGE_FAIL,
  PIPELINE_EVENT_STAGE_RETRY,
  PIPELINE_EVENT_STAGE_START,
  type PipelineContext,
  type Stage,
} from './stage.js'

export const PIPELINE_KIND_DECK = 'deck' as const
export const PIPELINE_KIND_FILM = 'film' as const

export const PIPELINE_KINDS = [PIPELINE_KIND_DECK, PIPELINE_KIND_FILM] as const

export type PipelineKind = (typeof PIPELINE_KINDS)[number]
export type PipelineStage = string

export interface PipelineDefinition<K extends PipelineKind = PipelineKind, S extends string = PipelineStage> {
  checkpointArtifactsByStage: Partial<Record<S, readonly string[]>>
  defaultRerunStage: S
  kind: K
  stages: readonly S[]
}

export function isPipelineKind(value: string | undefined): value is PipelineKind {
  return value !== undefined && (PIPELINE_KINDS as readonly string[]).includes(value)
}

export function detectPipelineKind(job: {pipeline: string}): PipelineKind {
  if (isPipelineKind(job.pipeline)) {
    return job.pipeline
  }

  throw new Error(`Unsupported project pipeline kind in job-state.json: ${job.pipeline}`)
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

export async function runPipeline<I, O>(input: I, stages: readonly Stage<unknown, unknown>[], ctx: PipelineContext): Promise<O> {
  let current: unknown = input
  const maxRetries = requireNonnegativeInteger(ctx.retryPolicy?.maxRetries ?? 0, 'retryPolicy.maxRetries')
  const maxAttempts = maxRetries + 1
  const retryDelayMs = requireNonnegativeInteger(ctx.retryPolicy?.backoffMs ?? 0, 'retryPolicy.backoffMs')

  // Stages must execute in order because each one consumes the previous checkpoint.
  /* eslint-disable no-await-in-loop */
  for (const stage of stages) {
    let attempt = 1

    while (true) {
      await ctx.emit({
        attempt,
        maxAttempts,
        projectId: ctx.projectId,
        stage: stage.name,
        time: new Date().toISOString(),
        type: PIPELINE_EVENT_STAGE_START,
      })

      try {
        current = await stage.run(current, ctx)
      } catch (error) {
        await ctx.emit({
          attempt,
          maxAttempts,
          message: error instanceof Error ? error.message : String(error),
          projectId: ctx.projectId,
          stage: stage.name,
          time: new Date().toISOString(),
          type: PIPELINE_EVENT_STAGE_FAIL,
        })

        if (attempt >= maxAttempts) {
          throw error
        }

        await ctx.emit({
          attempt,
          maxAttempts,
          message: error instanceof Error ? error.message : String(error),
          projectId: ctx.projectId,
          retryDelayMs,
          stage: stage.name,
          time: new Date().toISOString(),
          type: PIPELINE_EVENT_STAGE_RETRY,
        })

        if (retryDelayMs > 0) {
          await sleep(retryDelayMs)
        }

        attempt += 1
        continue
      }

      await ctx.emit({
        attempt,
        maxAttempts,
        projectId: ctx.projectId,
        stage: stage.name,
        time: new Date().toISOString(),
        type: PIPELINE_EVENT_STAGE_COMPLETE,
      })
      break
    }
  }
  /* eslint-enable no-await-in-loop */

  return current as O
}

function requireNonnegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Pipeline ${field} must be a non-negative integer; no retry policy clamp fallback is allowed. Received: ${String(value)}`)
  }

  return value
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
