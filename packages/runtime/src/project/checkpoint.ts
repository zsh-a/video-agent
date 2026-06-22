import type {PipelineDefinition, PipelineStage} from '@video-agent/core'

import {access} from 'node:fs/promises'

import {ARTIFACT_MANIFEST_NAME} from '../artifacts/artifact-names.js'
import {verifyProjectArtifacts} from '../artifacts/index.js'
import {createProjectWorkspace} from '../shared/workspace.js'

export class PipelineCheckpointError extends Error {
  readonly changedArtifacts: string[]
  readonly fromStage: PipelineStage
  readonly missingArtifacts: string[]
  readonly schemaInvalidArtifacts: string[]
  readonly untrackedArtifacts: string[]

  constructor(fromStage: PipelineStage, issues: {changedArtifacts?: string[]; missingArtifacts?: string[]; schemaInvalidArtifacts?: string[]; untrackedArtifacts?: string[]}) {
    const changedArtifacts = issues.changedArtifacts ?? []
    const missingArtifacts = issues.missingArtifacts ?? []
    const schemaInvalidArtifacts = issues.schemaInvalidArtifacts ?? []
    const untrackedArtifacts = issues.untrackedArtifacts ?? []
    const issueMessages = [
      ...(missingArtifacts.length === 0 ? [] : [`missing: ${missingArtifacts.join(', ')}`]),
      ...(changedArtifacts.length === 0 ? [] : [`changed: ${changedArtifacts.join(', ')}`]),
      ...(schemaInvalidArtifacts.length === 0 ? [] : [`schema invalid: ${schemaInvalidArtifacts.join(', ')}`]),
      ...(untrackedArtifacts.length === 0 ? [] : [`untracked: ${untrackedArtifacts.join(', ')}`]),
    ]

    super(`Cannot resume from ${fromStage}; checkpoint artifact issue(s): ${issueMessages.join('; ')}.`)
    this.changedArtifacts = changedArtifacts
    this.fromStage = fromStage
    this.missingArtifacts = missingArtifacts
    this.schemaInvalidArtifacts = schemaInvalidArtifacts
    this.untrackedArtifacts = untrackedArtifacts
    this.name = 'PipelineCheckpointError'
  }
}

export async function assertPipelineCheckpointArtifacts(projectId: string, workspaceDir: string, definition: PipelineDefinition, fromStage: PipelineStage): Promise<void> {
  const workspace = await createProjectWorkspace({
    projectId,
    workspaceDir,
  })
  const checkpointArtifacts = definition.checkpointArtifactsByStage[fromStage]

  if (checkpointArtifacts === undefined) {
    throw new Error(`Unknown ${definition.kind} pipeline stage: ${fromStage}`)
  }

  if (checkpointArtifacts.length === 0) {
    return
  }

  const requiredArtifacts = [...checkpointArtifacts, ARTIFACT_MANIFEST_NAME]
  const missing = (
    await Promise.all(
      requiredArtifacts.map(async (artifact) => await fileExists(workspace.store.resolve(artifact)) ? null : artifact),
    )
  ).filter((artifact): artifact is string => artifact !== null)
  const integrity = await verifyProjectArtifacts(workspace.projectId, workspace.workspaceDir)
  const required = new Set(requiredArtifacts)
  const changedArtifacts = integrity.changed.map((issue) => issue.name).filter((artifact) => required.has(artifact))
  const missingManifestArtifacts = integrity.missing.map((issue) => issue.name).filter((artifact) => required.has(artifact))
  const schemaInvalidArtifacts = integrity.schemaInvalid.map((issue) => issue.name).filter((artifact) => required.has(artifact))
  const untrackedArtifacts = integrity.untracked.filter((artifact) => required.has(artifact))
  const missingArtifacts = [...new Set([...missing, ...missingManifestArtifacts])]

  if (missingArtifacts.length > 0 || changedArtifacts.length > 0 || schemaInvalidArtifacts.length > 0 || untrackedArtifacts.length > 0) {
    throw new PipelineCheckpointError(fromStage, {
      changedArtifacts,
      missingArtifacts,
      schemaInvalidArtifacts,
      untrackedArtifacts,
    })
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }

    throw error
  }
}
