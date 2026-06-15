import {createHash} from 'node:crypto'
import {mkdir, readdir, stat} from 'node:fs/promises'
import {dirname, join} from 'node:path'

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

  const entries = await readdir(artifactsDir, {withFileTypes: true})
  const artifacts = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name !== ARTIFACT_MANIFEST_NAME)
      .map(async (entry) => {
        const path = join(artifactsDir, entry.name)
        const [content, metadata] = await Promise.all([bunFile(path).bytes(), stat(path)])

        return {
          kind: inferArtifactKind(entry.name),
          name: entry.name,
          sha256: createHash('sha256').update(content).digest('hex'),
          size: metadata.size,
          updatedAt: metadata.mtime.toISOString(),
        }
      }),
  )
  const manifest: ArtifactManifest = {
    artifacts: artifacts.sort((a, b) => a.name.localeCompare(b.name)),
    generatedAt: new Date().toISOString(),
    version: 1,
  }

  await bunWrite(join(artifactsDir, ARTIFACT_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)

  return manifest
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
