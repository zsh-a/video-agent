import type {JsonJobStore} from '@video-agent/db'

import {JsonJobStore as JsonDeckJobStore} from '@video-agent/db'
import {resolve} from 'node:path'

import {createProjectWorkspace, type ProjectWorkspace, refreshArtifactManifest} from '@video-agent/runtime'
import {DECK_STAGES} from './deck-stages.js'
import {DECK_PIPELINE_DEFINITION} from './pipeline.js'

export interface DeckFinalRenderContext {
  jobStore: JsonJobStore
  projectId: string
  workspace: ProjectWorkspace
  workspaceDir: string
}

export async function openDeckFinalRenderContext(options: {projectId: string; workspaceDir?: string}): Promise<DeckFinalRenderContext> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new JsonDeckJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })

  await jobStore.initialize({
    inputPath: state.inputPath,
    pipeline: DECK_PIPELINE_DEFINITION.kind,
    projectId,
    stages: DECK_STAGES,
  })
  await jobStore.updateStage('render-final', 'running', undefined, 1)

  return {
    jobStore,
    projectId,
    workspace,
    workspaceDir,
  }
}

export async function completeDeckFinalRender(context: DeckFinalRenderContext, message?: string): Promise<void> {
  await context.jobStore.updateStage('render-final', 'completed', message, 1)
  await refreshArtifactManifest(context.workspace.artifactsDir)
}

export async function failDeckFinalRender(context: DeckFinalRenderContext, error: unknown): Promise<void> {
  await context.jobStore.updateStage('render-final', 'failed', error instanceof Error ? error.message : String(error), 1)
}
