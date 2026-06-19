import type {RecoverableJobStatus} from '@video-agent/pipeline-film'
import type {ProviderSmokeTestRole} from '@video-agent/runtime'

import {listProjects} from '@video-agent/runtime'

export async function readMostRecentProjectId(workspaceDir: string): Promise<string> {
  const [project] = await listProjects(workspaceDir)

  if (project === undefined) {
    throw new Error('No projects found. Pass --project when using --action rerun.')
  }

  return project.projectId
}

export function resolveProviderSmokeTestRoles(role: string): ProviderSmokeTestRole[] | undefined {
  if (role === 'all') {
    return undefined
  }

  if (role === 'asr' || role === 'tts' || role === 'vlm') {
    return [role]
  }

  throw new Error(`Invalid provider role: ${role}`)
}

export function resolveRecoverableStatuses(status: string): RecoverableJobStatus[] {
  if (status === 'failed') {
    return ['failed']
  }

  if (status === 'running') {
    return ['running']
  }

  return ['failed', 'running']
}
