import {resolve} from 'node:path'

import {readConfig} from './config.js'
import {createConfiguredJobStore} from './job-store.js'
import {listProjectArtifactNames} from './project-artifact-list.js'
import {readProjectRuntimeSummary} from './project-runtime-summary.js'
import type {ProjectStatus} from './project-status-types.js'

export type {
  ProjectRuntimeSummary,
  ProjectStatus,
  ProviderRoleSummary,
  QualitySummary,
  RenderSummary,
} from './project-status-types.js'

export async function readProjectStatus(projectId: string, workspaceDir = '.video-agent'): Promise<ProjectStatus> {
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
  const artifacts = await listProjectArtifactNames(artifactsDir)
  const summary = await readProjectRuntimeSummary(artifactsDir)

  return {
    artifacts,
    job,
    projectDir,
    projectId,
    summary,
  }
}
