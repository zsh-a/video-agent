import type {PipelineContext, Stage} from './stage.js'

export async function runPipeline<I, O>(input: I, stages: readonly Stage<unknown, unknown>[], ctx: PipelineContext): Promise<O> {
  let current: unknown = input

  // Stages must execute in order because each one consumes the previous checkpoint.
  /* eslint-disable no-await-in-loop */
  for (const stage of stages) {
    await ctx.emit({
      projectId: ctx.projectId,
      stage: stage.name,
      time: new Date().toISOString(),
      type: 'stage:start',
    })

    try {
      current = await stage.run(current, ctx)
    } catch (error) {
      await ctx.emit({
        message: error instanceof Error ? error.message : String(error),
        projectId: ctx.projectId,
        stage: stage.name,
        time: new Date().toISOString(),
        type: 'stage:fail',
      })
      throw error
    }

    await ctx.emit({
      projectId: ctx.projectId,
      stage: stage.name,
      time: new Date().toISOString(),
      type: 'stage:complete',
    })
  }
  /* eslint-enable no-await-in-loop */

  return current as O
}
