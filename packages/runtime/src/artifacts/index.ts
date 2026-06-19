import {stat} from 'node:fs/promises'
import {extname, resolve} from 'node:path'

import type {ArtifactManifest} from './store.js'

import {ARTIFACT_MANIFEST_NAME} from './store.js'
import {collectArtifactFiles} from './files.js'
import {bunFile} from '../shared/bun-runtime.js'
import {readOptionalJson} from '../shared/file-io.js'

export {verifyProjectArtifacts} from './integrity.js'

export interface ProjectArtifact {
  kind: 'json' | 'log' | 'other'
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

export async function listProjectArtifacts(projectId: string, workspaceDir = '.video-agent'): Promise<ProjectArtifact[]> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const manifest = await readArtifactManifest(artifactsDir)
  const entries = await collectArtifactFiles(artifactsDir, artifactsDir)
  const artifacts = await Promise.all(
    entries
      .map(async (entry) => {
        const path = resolve(artifactsDir, entry.name)
        const metadata = await stat(path)
        const manifestEntry = manifest?.artifacts.find((artifact) => artifact.name === entry.name)

        return {
          kind: inferArtifactKind(entry.name),
          name: entry.name,
          path,
          ...(manifestEntry?.sha256 === undefined ? {} : {sha256: manifestEntry.sha256}),
          size: metadata.size,
          updatedAt: metadata.mtime.toISOString(),
        }
      }),
  )

  return artifacts.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readProjectArtifact(projectId: string, artifactName: string, workspaceDir = '.video-agent'): Promise<ReadProjectArtifactResult> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const path = resolve(artifactsDir, artifactName)

  if (!path.startsWith(`${artifactsDir}/`)) {
    throw new Error(`Invalid artifact path: ${artifactName}`)
  }

  const metadata = await stat(path)
  const manifest = await readArtifactManifest(artifactsDir)
  const manifestEntry = manifest?.artifacts.find((item) => item.name === artifactName)
  const artifact = {
    kind: inferArtifactKind(artifactName),
    name: artifactName,
    path,
    ...(manifestEntry?.sha256 === undefined ? {} : {sha256: manifestEntry.sha256}),
    size: metadata.size,
    updatedAt: metadata.mtime.toISOString(),
  }
  const text = await bunFile(path).text()
  const content = artifact.kind === 'json' ? JSON.parse(text) : text

  return {
    artifact,
    content,
  }
}

export async function readProjectArtifactManifest(projectId: string, workspaceDir = '.video-agent'): Promise<ArtifactManifest | undefined> {
  return readArtifactManifest(resolve(workspaceDir, 'projects', projectId, 'artifacts'))
}

async function readArtifactManifest(artifactsDir: string): Promise<ArtifactManifest | undefined> {
  return readOptionalJson<ArtifactManifest>(resolve(artifactsDir, ARTIFACT_MANIFEST_NAME))
}

function inferArtifactKind(name: string): ProjectArtifact['kind'] {
  if (extname(name) === '.json') {
    return 'json'
  }

  if (extname(name) === '.jsonl' || extname(name) === '.log') {
    return 'log'
  }

  return 'other'
}
