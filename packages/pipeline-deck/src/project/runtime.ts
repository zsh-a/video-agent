import type {LLMTraceRecorder} from '@video-agent/llm'

import {JsonJobStore} from '@video-agent/db'
import {createJsonlLLMTraceRecorder} from '@video-agent/llm'
import {resolve} from 'node:path'

import type {ProjectWorkspace} from '@video-agent/runtime'

export const DEFAULT_MAX_SLIDE_CHARACTERS = 260
export const DEFAULT_SLIDE_SECONDS = 18

const LLM_TRACE_ARTIFACT_NAME = 'llm-traces.jsonl'

export interface ProjectLLMTrace {
  path?: string
  recorder?: LLMTraceRecorder
}

export function createProjectLLMTrace(workspace: ProjectWorkspace, enabled: boolean | undefined): ProjectLLMTrace {
  if (enabled !== true) {
    return {}
  }

  const path = workspace.store.resolve(LLM_TRACE_ARTIFACT_NAME)

  return {
    path,
    recorder: createJsonlLLMTraceRecorder(path),
  }
}

export function createDeckJobStore(projectDir: string): JsonJobStore {
  return new JsonJobStore(resolve(projectDir, 'job-state.json'))
}

export function withLLMTracePath(error: unknown, tracePath: string | undefined): Error {
  const message = error instanceof Error ? error.message : String(error)
  const suffix = tracePath === undefined ? '' : `\nLLM trace: ${tracePath}`

  return new Error(`${message}${suffix}`, {
    cause: error,
  })
}
