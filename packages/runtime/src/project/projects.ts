import type {JobState} from '@video-agent/db'

import {readdir} from 'node:fs/promises'
import {resolve} from 'node:path'

import {readConfig} from '../shared/config.js'
import {createConfiguredJobStore} from '../shared/job-store.js'

import {DEFAULT_WORKSPACE_DIR} from '../shared/defaults.js'
export interface ProjectSummary {
  projectDir: string
  projectId: string
  status: JobState['status']
  updatedAt: string
}

export async function listProjects(workspaceDir = DEFAULT_WORKSPACE_DIR): Promise<ProjectSummary[]> {
  const resolvedWorkspaceDir = resolve(workspaceDir)
  const config = await readConfig(resolvedWorkspaceDir)
  const projectsDir = resolve(resolvedWorkspaceDir, 'projects')
  const entries = await readdir(projectsDir, {withFileTypes: true}).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw error
  })
  const projectResults = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const projectDir = resolve(projectsDir, entry.name)
        const job = await createConfiguredJobStore({
          config,
          projectDir,
          projectId: entry.name,
          workspaceDir: resolvedWorkspaceDir,
        }).read()

        return {
          projectDir,
          projectId: entry.name,
          status: job.status,
          updatedAt: job.updatedAt,
        }
      }),
  )

  return projectResults.sort((a, b) => {
    const updatedAtOrder = b.updatedAt.localeCompare(a.updatedAt)

    return updatedAtOrder === 0 ? a.projectId.localeCompare(b.projectId) : updatedAtOrder
  })
}

export async function readMostRecentProjectId(workspaceDir = DEFAULT_WORKSPACE_DIR): Promise<string> {
  const [project] = await listProjects(workspaceDir)

  if (project === undefined) {
    throw new Error(`No projects found in workspace ${workspaceDir}.`)
  }

  return project.projectId
}
