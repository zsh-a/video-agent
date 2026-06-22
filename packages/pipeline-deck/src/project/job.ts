import type {JobStore} from '@video-agent/db'

import {DECK_PIPELINE_DEFINITION, DECK_PIPELINE_STAGES} from '../pipeline.js'

export async function initializeDeckJob(jobStore: JobStore, input: {
  inputPath: string
  projectId: string
}): Promise<void> {
  await jobStore.initialize({
    inputPath: input.inputPath,
    pipeline: DECK_PIPELINE_DEFINITION.kind,
    projectId: input.projectId,
    stages: DECK_PIPELINE_STAGES,
  })
}
