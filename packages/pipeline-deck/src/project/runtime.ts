import type {LLMTraceRecorder} from '@video-agent/llm'
import type {JobStore} from '@video-agent/db'

import {createJsonlLLMTraceRecorder} from '@video-agent/llm'
import {resolve} from 'node:path'

import {LLM_TRACES_LOG_ARTIFACT_NAME, createConfiguredJobStore, readConfig, type ProjectWorkspace} from '@video-agent/runtime'

export const DEFAULT_MAX_SLIDE_CHARACTERS = 260

export interface ProjectLLMTrace {
  path?: string
  recorder?: LLMTraceRecorder
}

export function createProjectLLMTrace(workspace: ProjectWorkspace, enabled: boolean | undefined): ProjectLLMTrace {
  if (enabled !== true) {
    return {}
  }

  const path = workspace.store.resolve(LLM_TRACES_LOG_ARTIFACT_NAME)

  return {
    path,
    recorder: createJsonlLLMTraceRecorder(path),
  }
}

export async function createDeckJobStore(options: {projectId: string; workspaceDir: string}): Promise<JobStore> {
  const workspaceDir = resolve(options.workspaceDir)
  const config = await readConfig(workspaceDir)

  return createConfiguredJobStore({
    config,
    projectDir: resolve(workspaceDir, 'projects', options.projectId),
    projectId: options.projectId,
    workspaceDir,
  })
}

export function withLLMTracePath(error: unknown, tracePath: string | undefined): Error {
  const message = error instanceof Error ? error.message : String(error)
  const suffix = tracePath === undefined ? '' : `\nLLM trace: ${tracePath}`

  return new Error(`${message}${suffix}`, {
    cause: error,
  })
}
