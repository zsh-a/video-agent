import type {JobStore} from '@video-agent/db'

import {DECK_PIPELINE_DEFINITION} from '../pipeline.js'

export async function initializeDeckJob(jobStore: JobStore, input: {
  inputPath: string
  projectId: string
  stages: readonly string[]
}): Promise<void> {
  await jobStore.initialize({
    inputPath: input.inputPath,
    pipeline: DECK_PIPELINE_DEFINITION.kind,
    projectId: input.projectId,
    stages: input.stages,
  })
}

export async function completeDeckJobStages(jobStore: JobStore, stages: readonly string[]): Promise<void> {
  await stages.reduce(
    async (previous, stage) => {
      await previous
      await jobStore.updateStage(stage, 'completed', undefined, 1)
    },
    Promise.resolve(),
  )
}
