import {readFile, stat} from 'node:fs/promises'
import {resolve} from 'node:path'

import type {ArtifactKind} from './files.js'
import type {ArtifactManifest} from './store.js'

import {ARTIFACT_MANIFEST_NAME} from './artifact-names.js'
import {readRequiredArtifactManifest} from './store.js'
import {collectArtifactFiles, JSON_ARTIFACT_KIND} from './files.js'
import {JsonFileParseError, readOptionalJson} from '../shared/file-io.js'

import {DEFAULT_WORKSPACE_DIR} from '../shared/defaults.js'
export {verifyProjectArtifacts} from './integrity.js'

export interface ProjectArtifact {
  kind: ArtifactKind
  name: string
  path: string
  sha256?: string
  size: number
  updatedAt: string
}

export interface ReadProjectArtifactResult {
  artifact: ProjectArtifact
  content: unknown
}

export interface ArtifactIntegrityChangedIssue {
  actualSha256: string
  actualSize: number
  expectedSha256: string
  expectedSize: number
  name: string
}

export interface ArtifactIntegrityMissingIssue {
  name: string
  reason: 'missing'
}

export interface ArtifactSchemaInvalidIssue {
  issues: ArtifactSchemaIssue[]
  name: string
}

export interface ArtifactSchemaIssue {
  code: string
  message: string
  path: string[]
}

export interface ArtifactIntegrityResult {
  changed: ArtifactIntegrityChangedIssue[]
  checked: number
  manifestPath: string
  missing: ArtifactIntegrityMissingIssue[]
  ok: boolean
  schemaInvalid: ArtifactSchemaInvalidIssue[]
  summary: ArtifactIntegritySummary
  untracked: string[]
}

export interface ArtifactIntegritySummary {
  changed: number
  checked: number
  errors: number
  missing: number
  schemaInvalid: number
  untracked: number
  warnings: number
}

export async function listProjectArtifacts(projectId: string, workspaceDir = DEFAULT_WORKSPACE_DIR): Promise<ProjectArtifact[]> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const manifest = await readRequiredArtifactManifest(artifactsDir)
  const manifestEntries = new Map(manifest.artifacts.map((artifact) => [artifact.name, artifact]))
  const entries = await collectArtifactFiles(artifactsDir, artifactsDir)
  const artifacts = await Promise.all(
    entries
      .map(async (entry) => {
        const path = resolve(artifactsDir, entry.name)
        const metadata = await stat(path)

        if (entry.name === ARTIFACT_MANIFEST_NAME) {
          return {
            kind: JSON_ARTIFACT_KIND,
            name: entry.name,
            path,
            size: metadata.size,
            updatedAt: metadata.mtime.toISOString(),
          }
        }

        const manifestEntry = manifestEntries.get(entry.name)

        if (manifestEntry === undefined) {
          throw new Error(`Project artifact "${entry.name}" is not tracked in ${ARTIFACT_MANIFEST_NAME}; no file-name kind inference fallback is allowed.`)
        }

        return {
          kind: manifestEntry.kind,
          name: entry.name,
          path,
          sha256: manifestEntry.sha256,
          size: metadata.size,
          updatedAt: metadata.mtime.toISOString(),
        }
      }),
  )

  return artifacts.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readProjectArtifact(projectId: string, artifactName: string, workspaceDir = DEFAULT_WORKSPACE_DIR): Promise<ReadProjectArtifactResult> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const path = resolve(artifactsDir, artifactName)

  if (!path.startsWith(`${artifactsDir}/`)) {
    throw new Error(`Invalid artifact path: ${artifactName}`)
  }

  const metadata = await stat(path)
  const manifest = await readRequiredArtifactManifest(artifactsDir)
  const manifestEntry = artifactName === ARTIFACT_MANIFEST_NAME
    ? undefined
    : manifest.artifacts.find((item) => item.name === artifactName)

  if (artifactName !== ARTIFACT_MANIFEST_NAME && manifestEntry === undefined) {
    throw new Error(`Project artifact "${artifactName}" is not tracked in ${ARTIFACT_MANIFEST_NAME}; no file-name kind inference fallback is allowed.`)
  }

  const artifact = {
    kind: manifestEntry?.kind ?? JSON_ARTIFACT_KIND,
    name: artifactName,
    path,
    ...(manifestEntry === undefined ? {} : {sha256: manifestEntry.sha256}),
    size: metadata.size,
    updatedAt: metadata.mtime.toISOString(),
  }
  const content = artifact.kind === 'json'
    ? await readProjectArtifactJsonContent(path, artifactName)
    : await readFile(path, 'utf8')

  return {
    artifact,
    content,
  }
}

async function readProjectArtifactJsonContent(path: string, artifactName: string): Promise<unknown> {
  try {
    const value = await readOptionalJson(path)

    if (value === undefined) {
      throw Object.assign(new Error(`Project artifact "${artifactName}" is missing.`), {code: 'ENOENT'})
    }

    return value
  } catch (error) {
    if (error instanceof JsonFileParseError) {
      throw new Error(`Project artifact "${artifactName}" is invalid JSON; no artifact content fallback is allowed. ${error.details.issues}`)
    }

    throw error
  }
}

export async function readProjectArtifactManifest(projectId: string, workspaceDir = DEFAULT_WORKSPACE_DIR): Promise<ArtifactManifest> {
  return readRequiredArtifactManifest(resolve(workspaceDir, 'projects', projectId, 'artifacts'))
}
