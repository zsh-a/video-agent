import type {PipelineContext, Stage} from './stage.js'

export async function runPipeline<I, O>(input: I, stages: readonly Stage<unknown, unknown>[], ctx: PipelineContext): Promise<O> {
  let current: unknown = input
  const maxRetries = Math.max(0, ctx.retryPolicy?.maxRetries ?? 0)
  const maxAttempts = maxRetries + 1
  const retryDelayMs = Math.max(0, ctx.retryPolicy?.backoffMs ?? 0)

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
        type: 'stage:start',
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
          type: 'stage:fail',
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
          type: 'stage:retry',
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
        type: 'stage:complete',
      })
      break
    }
  }
  /* eslint-enable no-await-in-loop */

  return current as O
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
