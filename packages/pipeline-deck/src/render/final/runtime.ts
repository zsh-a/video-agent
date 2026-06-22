import type {JobStore} from '@video-agent/db'

import {resolve} from 'node:path'

import {createProjectAgentRuntime, createProjectWorkspace, type ProjectAgentRuntime, type ProjectWorkspace, refreshArtifactManifest, DEFAULT_WORKSPACE_DIR} from '@video-agent/runtime'
import {DECK_PIPELINE_DEFINITION, DECK_STAGE_IDS} from '../../pipeline.js'
import {createDeckJobStore} from '../../project/runtime.js'

export interface DeckFinalRenderContext {
  agent: ProjectAgentRuntime
  jobStore: JobStore
  projectId: string
  workspace: ProjectWorkspace
  workspaceDir: string
}

export async function openDeckFinalRenderContext(options: {projectId: string; workspaceDir?: string}): Promise<DeckFinalRenderContext> {
  const workspaceDir = resolve(options.workspaceDir ?? DEFAULT_WORKSPACE_DIR)
  const projectId = options.projectId
  const jobStore = await createDeckJobStore({projectId, workspaceDir})
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
    stages: DECK_PIPELINE_DEFINITION.stages,
  })
  const agent = createProjectAgentRuntime({
    jobStore,
    workspace,
  })

  await agent.startRun('Deck final render started')
  await agent.startStage(DECK_STAGE_IDS.visualPreflight, 'Checking deck visual artifacts')

  return {
    agent,
    jobStore,
    projectId,
    workspace,
    workspaceDir,
  }
}

export async function beginDeckFinalRender(context: DeckFinalRenderContext, message = 'Rendering final deck video'): Promise<void> {
  await context.agent.completeStage(DECK_STAGE_IDS.visualPreflight, 'Deck visual preflight complete')
  await context.agent.startStage(DECK_STAGE_IDS.renderFinal, message)
}

export async function completeDeckFinalRender(context: DeckFinalRenderContext, message?: string): Promise<void> {
  await context.agent.completeStage(DECK_STAGE_IDS.renderFinal, message)
  await context.agent.startStage(DECK_STAGE_IDS.review, 'Writing deck render review')
  await context.agent.completeStage(DECK_STAGE_IDS.review, 'Deck final render reviewed')
  await context.agent.completeRun('Deck final render complete')
  await refreshArtifactManifest(context.workspace.artifactsDir)
}

export async function failDeckFinalRender(context: DeckFinalRenderContext, error: unknown): Promise<void> {
  await context.agent.failRun(error)
}
