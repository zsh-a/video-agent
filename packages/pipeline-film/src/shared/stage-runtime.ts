import type {JobStore} from '@video-agent/db'
import type {LLMTraceRecorder} from '@video-agent/llm'
import type {ProjectAgentRuntime, ProjectWorkspace, ProviderCallRecorder} from '@video-agent/runtime'

import {createJsonlLLMTraceRecorder} from '@video-agent/llm'
import {resolve} from 'node:path'

import {LLM_TRACES_LOG_ARTIFACT_NAME, PROVIDER_CALLS_LOG_ARTIFACT_NAME, createConfiguredJobStore, createJsonlProviderCallRecorder, createProjectAgentRuntime, createProjectWorkspace, readConfig, DEFAULT_WORKSPACE_DIR} from '@video-agent/runtime'
import {type FilmPipelineStage} from '../pipeline.js'

export interface FilmStageWorkspace {
  agent: ProjectAgentRuntime
  jobStore: JobStore
  workspace: ProjectWorkspace
}

export async function openFilmStageWorkspace(input: {
  projectId: string
  stage: FilmPipelineStage
  workspaceDir?: string
}): Promise<FilmStageWorkspace> {
  const workspaceDir = input.workspaceDir ?? DEFAULT_WORKSPACE_DIR
  const jobStore = await createFilmJobStore(input.projectId, workspaceDir)
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId: input.projectId,
    workspaceDir,
  })
  const agent = createProjectAgentRuntime({
    jobStore,
    workspace,
  })

  await agent.startRun(`Film stage ${input.stage} started`)
  await agent.startStage(input.stage)

  return {agent, jobStore, workspace}
}

export async function createFilmJobStore(projectId: string, workspaceDir: string): Promise<JobStore> {
  const resolvedWorkspaceDir = resolve(workspaceDir)
  const config = await readConfig(resolvedWorkspaceDir)
  const projectDir = resolve(resolvedWorkspaceDir, 'projects', projectId)

  return createConfiguredJobStore({
    config,
    projectDir,
    projectId,
    workspaceDir: resolvedWorkspaceDir,
  })
}

export function createFilmLLMTrace(workspace: ProjectWorkspace, enabled: boolean | undefined): {path?: string; recorder?: LLMTraceRecorder} {
  if (enabled !== true) {
    return {}
  }

  const path = workspace.store.resolve(LLM_TRACES_LOG_ARTIFACT_NAME)

  return {
    path,
    recorder: createJsonlLLMTraceRecorder(path),
  }
}

export function createFilmProviderCallRecorder(workspace: ProjectWorkspace): ProviderCallRecorder {
  return createJsonlProviderCallRecorder(workspace.store.resolve(PROVIDER_CALLS_LOG_ARTIFACT_NAME))
}
