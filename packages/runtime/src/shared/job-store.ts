import {BunSqliteJobStore, type JobState, type JobStore, JsonJobStore} from '@video-agent/db'
import {resolve} from 'node:path'

import type {AgentConfig} from './config.js'

export interface ConfiguredJobStoreOptions {
  config: AgentConfig
  projectDir: string
  projectId: string
  workspaceDir: string
}

export function createConfiguredJobStore(options: ConfiguredJobStoreOptions): JobStore {
  if (options.config.persistence.jobStore === 'sqlite') {
    return new BunSqliteJobStore(resolve(options.workspaceDir, 'state', 'jobs.db'), options.projectId)
  }

  return new JsonJobStore(resolve(options.projectDir, 'job-state.json'))
}

export function isJobStateNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  if ('code' in error && error.code === 'ENOENT') {
    return true
  }

  return error.message.startsWith('Job state not found for project:')
}

export async function readOptionalJobState(store: JobStore): Promise<JobState | undefined> {
  try {
    return await store.read()
  } catch (error) {
    if (isJobStateNotFound(error)) {
      return undefined
    }

    throw error
  }
}
