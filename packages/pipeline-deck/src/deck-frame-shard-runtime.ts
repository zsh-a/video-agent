import type {JobState, JsonJobStore} from '@video-agent/db'
import type {ProjectWorkspace} from '@video-agent/runtime'

import {JsonJobStore as DeckJsonJobStore} from '@video-agent/db'
import {createProjectWorkspace} from '@video-agent/runtime'
import {resolve} from 'node:path'

import {DECK_STAGES} from './deck-stages.js'
import {DECK_PIPELINE_DEFINITION} from './pipeline.js'

export interface DeckFrameShardWorkspace {
  jobStore: JsonJobStore
  projectId: string
  state: JobState
  workspace: ProjectWorkspace
  workspaceDir: string
}

export async function openDeckFrameShardWorkspace(options: {projectId: string; workspaceDir?: string}): Promise<DeckFrameShardWorkspace> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new DeckJsonJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
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
    stages: DECK_STAGES,
  })
  await input.jobStore.updateStage('render-final', 'running', undefined, 1)
}

export async function completeDeckFrameShardBatch(input: DeckFrameShardWorkspace, message: string): Promise<void> {
  await input.jobStore.updateStage('render-final', 'completed', message, 1)
}

export async function failDeckFrameShardBatch(input: DeckFrameShardWorkspace, error: unknown): Promise<void> {
  await input.jobStore.updateStage('render-final', 'failed', error instanceof Error ? error.message : String(error), 1)
}
