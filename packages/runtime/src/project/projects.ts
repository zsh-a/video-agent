import type {JobState} from '@video-agent/db'

import {readdir} from 'node:fs/promises'
import {resolve} from 'node:path'

import {readConfig} from '../shared/config.js'
import {createConfiguredJobStore, readOptionalJobState} from '../shared/job-store.js'

export interface ProjectSummary {
  projectDir: string
  projectId: string
  status?: JobState['status']
  updatedAt?: string
}

export async function listProjects(workspaceDir = '.video-agent'): Promise<ProjectSummary[]> {
  const resolvedWorkspaceDir = resolve(workspaceDir)
  const config = await readConfig(resolvedWorkspaceDir)
  const projectsDir = resolve(resolvedWorkspaceDir, 'projects')
  const entries = await readdir(projectsDir, {withFileTypes: true}).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw error
  })
  const projects = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const projectDir = resolve(projectsDir, entry.name)
        const job = await readOptionalJobState(
          createConfiguredJobStore({
            config,
            projectDir,
            projectId: entry.name,
            workspaceDir: resolvedWorkspaceDir,
          }),
        )

        return {
          projectDir,
          projectId: entry.name,
          status: job?.status,
          updatedAt: job?.updatedAt,
        }
      }),
  )

  return projects.sort((a, b) => {
    const updatedAtOrder = (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')

    return updatedAtOrder === 0 ? a.projectId.localeCompare(b.projectId) : updatedAtOrder
  })
}
