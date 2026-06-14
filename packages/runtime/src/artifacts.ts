import {createHash} from 'node:crypto'
import {readdir, readFile, stat} from 'node:fs/promises'
import {extname, resolve} from 'node:path'

import type {ArtifactManifest} from './artifact-store.js'

import {ARTIFACT_MANIFEST_NAME} from './artifact-store.js'

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

export interface ArtifactIntegrityResult {
  changed: ArtifactIntegrityChangedIssue[]
  checked: number
  manifestPath: string
  missing: ArtifactIntegrityMissingIssue[]
  ok: boolean
  untracked: string[]
}

export async function listProjectArtifacts(projectId: string, workspaceDir = '.video-agent'): Promise<ProjectArtifact[]> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const manifest = await readArtifactManifest(artifactsDir)
  const entries = await readdir(artifactsDir, {withFileTypes: true})
  const artifacts = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
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
  const text = await readFile(path, 'utf8')
  const content = artifact.kind === 'json' ? JSON.parse(text) : text

  return {
    artifact,
    content,
  }
}

export async function readProjectArtifactManifest(projectId: string, workspaceDir = '.video-agent'): Promise<ArtifactManifest | undefined> {
  return readArtifactManifest(resolve(workspaceDir, 'projects', projectId, 'artifacts'))
}

export async function verifyProjectArtifacts(projectId: string, workspaceDir = '.video-agent'): Promise<ArtifactIntegrityResult> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const manifestPath = resolve(artifactsDir, ARTIFACT_MANIFEST_NAME)
  const manifest = await readArtifactManifest(artifactsDir)

  if (manifest === undefined) {
    return {
      changed: [],
      checked: 0,
      manifestPath,
      missing: [{name: ARTIFACT_MANIFEST_NAME, reason: 'missing'}],
      ok: false,
      untracked: [],
    }
  }

  const changed: ArtifactIntegrityChangedIssue[] = []
  const missing: ArtifactIntegrityMissingIssue[] = []
  const manifestNames = new Set(manifest.artifacts.map((artifact) => artifact.name))

  await Promise.all(manifest.artifacts.map(async (artifact) => {
    const path = resolve(artifactsDir, artifact.name)

    try {
      const [content, metadata] = await Promise.all([readFile(path), stat(path)])
      const sha256 = createHash('sha256').update(content).digest('hex')

      if (sha256 !== artifact.sha256 || metadata.size !== artifact.size) {
        changed.push({
          actualSha256: sha256,
          actualSize: metadata.size,
          expectedSha256: artifact.sha256,
          expectedSize: artifact.size,
          name: artifact.name,
        })
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        missing.push({name: artifact.name, reason: 'missing'})
        return
      }

      throw error
    }
  }))

  const entries = await readdir(artifactsDir, {withFileTypes: true})
  const untracked = entries
    .filter((entry) => entry.isFile() && entry.name !== ARTIFACT_MANIFEST_NAME && !manifestNames.has(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  return {
    changed,
    checked: manifest.artifacts.length,
    manifestPath,
    missing,
    ok: changed.length === 0 && missing.length === 0 && untracked.length === 0,
    untracked,
  }
}

async function readArtifactManifest(artifactsDir: string): Promise<ArtifactManifest | undefined> {
  try {
    return JSON.parse(await readFile(resolve(artifactsDir, ARTIFACT_MANIFEST_NAME), 'utf8')) as ArtifactManifest
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    throw error
  }
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
