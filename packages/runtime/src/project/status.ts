import {resolve} from 'node:path'

import {readConfig} from '../shared/config.js'
import {JsonLineReadError} from '../shared/file-io.js'
import {createConfiguredJobStore} from '../shared/job-store.js'
import {readProjectAgentStatus} from './agent-status.js'
import {listProjectArtifactNames} from './artifact-list.js'
import {readProjectRuntimeSummary} from './runtime-summary.js'
import type {ProjectStatus} from './status-types.js'

import {DEFAULT_WORKSPACE_DIR} from '../shared/defaults.js'
export type {
  ProjectRuntimeSummary,
  ProjectStatus,
  ProviderRoleSummary,
  QualitySummary,
  RenderSummary,
} from './status-types.js'

export async function readProjectStatus(projectId: string, workspaceDir = DEFAULT_WORKSPACE_DIR): Promise<ProjectStatus> {
  const resolvedWorkspaceDir = resolve(workspaceDir)
  const projectDir = resolve(resolvedWorkspaceDir, 'projects', projectId)
  const artifactsDir = resolve(projectDir, 'artifacts')
  const config = await readConfig(resolvedWorkspaceDir)
  const job = await createConfiguredJobStore({
    config,
    projectDir,
    projectId,
    workspaceDir: resolvedWorkspaceDir,
  }).read()
  const [agent, artifacts, summary] = await Promise.all([
    readStatusAgentStatus(projectId, resolvedWorkspaceDir),
    listProjectArtifactNames(artifactsDir),
    readProjectRuntimeSummary(artifactsDir),
  ])

  return {
    agent,
    artifacts,
    job,
    projectDir,
    projectId,
    summary,
  }
}

async function readStatusAgentStatus(projectId: string, workspaceDir: string) {
  try {
    return await readProjectAgentStatus(projectId, workspaceDir)
  } catch (error) {
    if (error instanceof JsonLineReadError) {
      return {runs: []}
    }

    throw error
  }
}
