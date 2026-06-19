import type {TuiSnapshot} from './model.js'
import type {ReadTuiSnapshotOptions} from './actions/types.js'

import {listProjectArtifacts, listProjects, readProjectEvents, readProjectStatus, verifyProjectArtifacts} from '@video-agent/runtime'

export async function readTuiSnapshot(options: ReadTuiSnapshotOptions): Promise<TuiSnapshot> {
  const projects = await listProjects(options.workspaceDir)
  const selectedProjectId = options.projectId ?? projects[0]?.projectId

  if (selectedProjectId === undefined) {
    return {
      artifacts: [],
      events: [],
      projects,
      workspaceDir: options.workspaceDir,
    }
  }

  const [selected, events, artifacts, artifactIntegrity] = await Promise.all([
    readProjectStatus(selectedProjectId, options.workspaceDir),
    readProjectEvents(selectedProjectId, {limit: options.eventLimit, workspaceDir: options.workspaceDir}),
    listProjectArtifacts(selectedProjectId, options.workspaceDir).then((items) => items.slice(0, options.artifactLimit)),
    verifyProjectArtifacts(selectedProjectId, options.workspaceDir),
  ])

  return {
    artifactIntegrity,
    artifacts,
    events: events.events,
    projects,
    selected,
    workspaceDir: options.workspaceDir,
  }
}
