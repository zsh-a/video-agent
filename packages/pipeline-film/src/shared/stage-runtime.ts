import type {PipelineEvent} from '@video-agent/core'
import type {JobStore} from '@video-agent/db'
import type {LLMTraceRecorder} from '@video-agent/llm'
import type {ProjectWorkspace, ProviderCallRecorder} from '@video-agent/runtime'

import {createJsonlLLMTraceRecorder} from '@video-agent/llm'
import {appendFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import {createConfiguredJobStore, createJsonlProviderCallRecorder, createProjectWorkspace, readConfig} from '@video-agent/runtime'
import {type FilmPipelineStage} from '../pipeline.js'

const LLM_TRACE_ARTIFACT_NAME = 'llm-traces.jsonl'

export interface FilmStageWorkspace {
  jobStore: JobStore
  workspace: ProjectWorkspace
}

export async function openFilmStageWorkspace(input: {
  projectId: string
  stage: FilmPipelineStage
  workspaceDir?: string
}): Promise<FilmStageWorkspace> {
  const workspaceDir = input.workspaceDir ?? '.video-agent'
  const jobStore = await createFilmJobStore(input.projectId, workspaceDir)
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId: input.projectId,
    workspaceDir,
  })

  await startFilmStage(jobStore, workspace, input.stage)

  return {jobStore, workspace}
}

export async function startFilmStage(jobStore: JobStore, workspace: ProjectWorkspace, stage: FilmPipelineStage): Promise<void> {
  await appendFilmEvent(workspace, {
    attempt: 1,
    level: 'info',
    projectId: workspace.projectId,
    stage,
    time: new Date().toISOString(),
    type: 'stage:start',
  })
  await jobStore.updateStage(stage, 'running', undefined, 1)
}

export async function completeFilmStage(jobStore: JobStore, workspace: ProjectWorkspace, stage: FilmPipelineStage): Promise<void> {
  await jobStore.updateStage(stage, 'completed', undefined, 1)
  await appendFilmEvent(workspace, {
    attempt: 1,
    level: 'info',
    projectId: workspace.projectId,
    stage,
    time: new Date().toISOString(),
    type: 'stage:complete',
  })
}

export async function failFilmStage(jobStore: JobStore, workspace: ProjectWorkspace, stage: FilmPipelineStage, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)

  await jobStore.updateStage(stage, 'failed', message, 1)
  await appendFilmEvent(workspace, {
    attempt: 1,
    level: 'error',
    message,
    projectId: workspace.projectId,
    stage,
    time: new Date().toISOString(),
    type: 'stage:fail',
  })
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

  const path = workspace.store.resolve(LLM_TRACE_ARTIFACT_NAME)

  return {
    path,
    recorder: createJsonlLLMTraceRecorder(path),
  }
}

export function createFilmProviderCallRecorder(workspace: ProjectWorkspace): ProviderCallRecorder {
  return createJsonlProviderCallRecorder(workspace.store.resolve('provider-calls.jsonl'))
}

async function appendFilmEvent(workspace: ProjectWorkspace, event: PipelineEvent): Promise<void> {
  await appendFile(workspace.store.resolve('pipeline-events.jsonl'), `${JSON.stringify(event)}\n`)
}
