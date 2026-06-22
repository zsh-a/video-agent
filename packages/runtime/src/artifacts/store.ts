import {createHash} from 'node:crypto'
import {mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {z} from 'zod'

import type {ArtifactKind} from './files.js'

import {ARTIFACT_MANIFEST_NAME} from './artifact-names.js'
import {ARTIFACT_KINDS, toArtifactName} from './files.js'
import {JsonFileParseError, readOptionalJson} from '../shared/file-io.js'
import {resolveArtifactKind} from './schema-registry.js'

export interface ArtifactStore {
  readJson(path: string): Promise<unknown>
  resolve(path: string): string
  writeJson(path: string, value: unknown): Promise<string>
}

export interface ArtifactManifest {
  artifacts: ArtifactManifestEntry[]
  generatedAt: string
  version: 1
}

export interface ArtifactManifestEntry {
  kind: ArtifactKind
  name: string
  sha256: string
  size: number
  updatedAt: string
}

export const ArtifactManifestEntrySchema = z.object({
  kind: z.enum(ARTIFACT_KINDS),
  name: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
}).strict()

export const ArtifactManifestSchema = z.object({
  artifacts: z.array(ArtifactManifestEntrySchema),
  generatedAt: z.string().min(1),
  version: z.literal(1),
}).strict().superRefine((manifest, ctx) => {
  const names = new Set<string>()

  manifest.artifacts.forEach((artifact, index) => {
    if (!isManifestArtifactName(artifact.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Artifact manifest entry "${artifact.name}" must be a normalized project artifact path.`,
        path: ['artifacts', index, 'name'],
      })
    }

    if (artifact.kind !== resolveArtifactKind(artifact.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Artifact manifest entry "${artifact.name}" kind must be "${resolveArtifactKind(artifact.name)}".`,
        path: ['artifacts', index, 'kind'],
      })
    }

    if (names.has(artifact.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Artifact manifest entry "${artifact.name}" is duplicated.`,
        path: ['artifacts', index, 'name'],
      })
    }

    names.add(artifact.name)
  })
})

export class FilesystemArtifactStore implements ArtifactStore {
  constructor(private readonly rootDir: string) {}

  async readJson(path: string): Promise<unknown> {
    try {
      const value = await readOptionalJson(this.resolve(path))

      if (value === undefined) {
        throw Object.assign(new Error(`Project artifact JSON is missing: ${path}`), {code: 'ENOENT'})
      }

      return value
    } catch (error) {
      if (error instanceof JsonFileParseError) {
        throw new Error(`Project artifact "${path}" is invalid JSON; no artifact store JSON fallback is allowed. ${error.details.issues}`)
      }

      throw error
    }
  }

  resolve(path: string): string {
    return join(this.rootDir, path)
  }

  async writeJson(path: string, value: unknown): Promise<string> {
    const resolved = this.resolve(path)
    await mkdir(dirname(resolved), {recursive: true})
    await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`)
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

  await writeFile(join(artifactsDir, ARTIFACT_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)

  return manifest
}

export async function readArtifactManifest(artifactsDir: string): Promise<ArtifactManifest | undefined> {
  let value: unknown | undefined

  try {
    value = await readOptionalJson(join(artifactsDir, ARTIFACT_MANIFEST_NAME))
  } catch (error) {
    if (error instanceof JsonFileParseError) {
      throw new Error(`Project artifact manifest ${ARTIFACT_MANIFEST_NAME} is invalid JSON; no manifest shape inference fallback is allowed. ${error.details.issues}`)
    }

    throw error
  }

  if (value === undefined) {
    return undefined
  }

  return parseArtifactManifest(value)
}

export async function readRequiredArtifactManifest(artifactsDir: string): Promise<ArtifactManifest> {
  const manifest = await readArtifactManifest(artifactsDir)

  if (manifest === undefined) {
    throw new Error(`Project artifacts require ${ARTIFACT_MANIFEST_NAME}; no file-name kind inference fallback is allowed.`)
  }

  return manifest
}

export function parseArtifactManifest(value: unknown): ArtifactManifest {
  const result = ArtifactManifestSchema.safeParse(value)

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`).join('; ')
    throw new Error(`Project artifact manifest ${ARTIFACT_MANIFEST_NAME} is invalid; no manifest shape inference fallback is allowed. ${issues}`)
  }

  return result.data
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

    const [content, metadata] = await Promise.all([readFile(path), stat(path)])

    return [{
      kind: resolveArtifactKind(name),
      name,
      sha256: createHash('sha256').update(content).digest('hex'),
      size: metadata.size,
      updatedAt: metadata.mtime.toISOString(),
    }]
  }))

  return nested.flat()
}

function isManifestArtifactName(name: string): boolean {
  if (name === ARTIFACT_MANIFEST_NAME || name.startsWith('/') || name.includes('\\')) {
    return false
  }

  const parts = name.split('/')

  return parts.every((part) => part !== '' && part !== '.' && part !== '..')
}
