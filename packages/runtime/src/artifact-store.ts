import {createHash} from 'node:crypto'
import {mkdir, readdir, stat} from 'node:fs/promises'
import {dirname, join, relative, sep} from 'node:path'

import {bunFile, bunWrite} from './bun-runtime.js'

export const ARTIFACT_MANIFEST_NAME = 'artifact-manifest.json'

export interface ArtifactStore {
  readJson<T>(path: string): Promise<T>
  resolve(path: string): string
  writeJson(path: string, value: unknown): Promise<string>
}

export interface ArtifactManifest {
  artifacts: ArtifactManifestEntry[]
  generatedAt: string
  version: 1
}

export interface ArtifactManifestEntry {
  kind: 'json' | 'log' | 'other'
  name: string
  sha256: string
  size: number
  updatedAt: string
}

export class FilesystemArtifactStore implements ArtifactStore {
  constructor(private readonly rootDir: string) {}

  async readJson<T>(path: string): Promise<T> {
    return bunFile(this.resolve(path)).json<T>()
  }

  resolve(path: string): string {
    return join(this.rootDir, path)
  }

  async writeJson(path: string, value: unknown): Promise<string> {
    const resolved = this.resolve(path)
    await mkdir(dirname(resolved), {recursive: true})
    await bunWrite(resolved, `${JSON.stringify(value, null, 2)}\n`)
    await refreshArtifactManifest(this.rootDir)
    return resolved
  }
}

export async function refreshArtifactManifest(artifactsDir: string): Promise<ArtifactManifest> {
  await mkdir(artifactsDir, {recursive: true})

  const artifacts = await collectManifestEntries(artifactsDir, artifactsDir)
  const manifest: ArtifactManifest = {
    artifacts: artifacts.sort((a, b) => a.name.localeCompare(b.name)),
    generatedAt: new Date().toISOString(),
    version: 1,
  }

  await bunWrite(join(artifactsDir, ARTIFACT_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)

  return manifest
}

async function collectManifestEntries(rootDir: string, currentDir: string): Promise<ArtifactManifestEntry[]> {
  const entries = await readdir(currentDir, {withFileTypes: true})
  const nested = await Promise.all(entries.map(async (entry): Promise<ArtifactManifestEntry[]> => {
    const path = join(currentDir, entry.name)

    if (entry.isDirectory()) {
      return collectManifestEntries(rootDir, path)
    }

    if (!entry.isFile()) {
      return []
    }

    const name = toArtifactName(rootDir, path)

    if (name === ARTIFACT_MANIFEST_NAME) {
      return []
    }

    const [content, metadata] = await Promise.all([bunFile(path).bytes(), stat(path)])

    return [{
      kind: inferArtifactKind(name),
      name,
      sha256: createHash('sha256').update(content).digest('hex'),
      size: metadata.size,
      updatedAt: metadata.mtime.toISOString(),
    }]
  }))

  return nested.flat()
}

function inferArtifactKind(name: string): ArtifactManifestEntry['kind'] {
  if (name.endsWith('.json')) {
    return 'json'
  }

  if (name.endsWith('.jsonl') || name.endsWith('.log')) {
    return 'log'
  }

  return 'other'
}

function toArtifactName(rootDir: string, path: string): string {
  return relative(rootDir, path).split(sep).join('/')
}
