import type {JobState, JobStore} from '@video-agent/db'
import type {ProjectWorkspace} from '@video-agent/runtime'

import {JOB_STATUS_COMPLETED, JOB_STATUS_FAILED, JOB_STATUS_RUNNING} from '@video-agent/db'
import {createProjectWorkspace, DEFAULT_WORKSPACE_DIR} from '@video-agent/runtime'
import {resolve} from 'node:path'

import {DECK_PIPELINE_DEFINITION, DECK_STAGE_IDS} from '../../../pipeline.js'
import {createDeckJobStore} from '../../../project/runtime.js'

export interface DeckFrameShardWorkspace {
  jobStore: JobStore
  projectId: string
  state: JobState
  workspace: ProjectWorkspace
  workspaceDir: string
}

export async function openDeckFrameShardWorkspace(options: {projectId: string; workspaceDir?: string}): Promise<DeckFrameShardWorkspace> {
  const workspaceDir = resolve(options.workspaceDir ?? DEFAULT_WORKSPACE_DIR)
  const projectId = options.projectId
  const jobStore = await createDeckJobStore({projectId, workspaceDir})
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })

  return {
    jobStore,
    projectId,
    state,
    workspace,
    workspaceDir,
  }
}

export async function beginDeckFrameShardBatch(input: DeckFrameShardWorkspace): Promise<void> {
  await input.jobStore.initialize({
    inputPath: input.state.inputPath,
    pipeline: DECK_PIPELINE_DEFINITION.kind,
    projectId: input.projectId,
    stages: DECK_PIPELINE_DEFINITION.stages,
  })
  await input.jobStore.updateStage(DECK_STAGE_IDS.renderFinal, JOB_STATUS_RUNNING, undefined, 1)
}

export async function completeDeckFrameShardBatch(input: DeckFrameShardWorkspace, message: string): Promise<void> {
  await input.jobStore.updateStage(DECK_STAGE_IDS.renderFinal, JOB_STATUS_COMPLETED, message, 1)
}

export async function failDeckFrameShardBatch(input: DeckFrameShardWorkspace, error: unknown): Promise<void> {
  await input.jobStore.updateStage(DECK_STAGE_IDS.renderFinal, JOB_STATUS_FAILED, error instanceof Error ? error.message : String(error), 1)
}
