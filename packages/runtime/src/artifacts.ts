import type {ZodType} from 'zod'

import {ClipPlanSchema, LongVideoAnalysisFramesSchema, LongVideoChapterSummariesSchema, LongVideoChunkPlanSchema, LongVideoChunkSilenceSchema, LongVideoChunkSummariesSchema, LongVideoChunkSummarySchema, LongVideoGlobalOutlineSchema, LongVideoSelectedMomentsSchema, MediaInfoSchema, NarrationSchema, StoryboardSchema, TimelineSchema} from '@video-agent/ir'
import {SceneFrameBatchesSchema, TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from '@video-agent/providers'
import {createHash} from 'node:crypto'
import {readdir, stat} from 'node:fs/promises'
import {extname, join, relative, resolve, sep} from 'node:path'

import type {ArtifactManifest} from './artifact-store.js'

import {ARTIFACT_MANIFEST_NAME} from './artifact-store.js'
import {bunFile} from './bun-runtime.js'
import {readOptionalJson} from './file-io.js'

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

const ARTIFACT_SCHEMAS: Record<string, ZodType> = {
  'chapters.json': LongVideoChapterSummariesSchema,
  'chunk-plan.json': LongVideoChunkPlanSchema,
  'chunk-summaries.json': LongVideoChunkSummariesSchema,
  'clip-plan.json': ClipPlanSchema,
  'frames.json': LongVideoAnalysisFramesSchema,
  'global-outline.json': LongVideoGlobalOutlineSchema,
  'media-info.json': MediaInfoSchema,
  'narration.json': NarrationSchema,
  'scene-analysis.json': VlmScenesSchema,
  'scene-batches.json': SceneFrameBatchesSchema,
  'selected-moments.json': LongVideoSelectedMomentsSchema,
  'storyboard.json': StoryboardSchema,
  'timeline.json': TimelineSchema,
  'transcript.json': TranscriptSchema,
  'tts-segments.json': TtsSegmentsSchema,
}

const NESTED_ARTIFACT_SCHEMAS: Array<{pattern: RegExp; schema: ZodType}> = [
  {pattern: /^chunks\/[^/]+\/summary\.json$/, schema: LongVideoChunkSummarySchema},
  {pattern: /^chunks\/[^/]+\/silence\.json$/, schema: LongVideoChunkSilenceSchema},
  {pattern: /^chunks\/[^/]+\/transcript\.json$/, schema: TranscriptSchema},
  {pattern: /^chunks\/[^/]+\/vlm\.json$/, schema: VlmScenesSchema},
]

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

export async function verifyProjectArtifacts(projectId: string, workspaceDir = '.video-agent'): Promise<ArtifactIntegrityResult> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const manifestPath = resolve(artifactsDir, ARTIFACT_MANIFEST_NAME)
  const manifest = await readArtifactManifest(artifactsDir)

  if (manifest === undefined) {
    const missing = [{name: ARTIFACT_MANIFEST_NAME, reason: 'missing'}] satisfies ArtifactIntegrityMissingIssue[]

    return {
      changed: [],
      checked: 0,
      manifestPath,
      missing,
      ok: false,
      schemaInvalid: [],
      summary: summarizeArtifactIntegrity({
        changed: [],
        checked: 0,
        missing,
        schemaInvalid: [],
        untracked: [],
      }),
      untracked: [],
    }
  }

  const changed: ArtifactIntegrityChangedIssue[] = []
  const missing: ArtifactIntegrityMissingIssue[] = []
  const schemaInvalid: ArtifactSchemaInvalidIssue[] = []
  const manifestNames = new Set(manifest.artifacts.map((artifact) => artifact.name))

  await Promise.all(manifest.artifacts.map(async (artifact) => {
    const path = resolve(artifactsDir, artifact.name)

    try {
      const [content, metadata] = await Promise.all([bunFile(path).bytes(), stat(path)])
      const sha256 = createHash('sha256').update(content).digest('hex')
      const schemaIssue = validateKnownArtifactSchema(artifact.name, content)

      if (sha256 !== artifact.sha256 || metadata.size !== artifact.size) {
        changed.push({
          actualSha256: sha256,
          actualSize: metadata.size,
          expectedSha256: artifact.sha256,
          expectedSize: artifact.size,
          name: artifact.name,
        })
      }

      if (schemaIssue !== undefined) {
        schemaInvalid.push(schemaIssue)
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        missing.push({name: artifact.name, reason: 'missing'})
        return
      }

      throw error
    }
  }))

  missing.push(...await findMissingAnalysisFrameReferences(artifactsDir))

  const entries = await collectArtifactFiles(artifactsDir, artifactsDir)
  const untracked = entries
    .filter((entry) => entry.name !== ARTIFACT_MANIFEST_NAME && !manifestNames.has(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const sortedChanged = changed.sort((a, b) => a.name.localeCompare(b.name))
  const sortedMissing = missing.sort((a, b) => a.name.localeCompare(b.name))
  const sortedSchemaInvalid = schemaInvalid.sort((a, b) => a.name.localeCompare(b.name))

  return {
    changed: sortedChanged,
    checked: manifest.artifacts.length,
    manifestPath,
    missing: sortedMissing,
    ok: changed.length === 0 && missing.length === 0 && schemaInvalid.length === 0 && untracked.length === 0,
    schemaInvalid: sortedSchemaInvalid,
    summary: summarizeArtifactIntegrity({
      changed: sortedChanged,
      checked: manifest.artifacts.length,
      missing: sortedMissing,
      schemaInvalid: sortedSchemaInvalid,
      untracked,
    }),
    untracked,
  }
}

async function findMissingAnalysisFrameReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const manifest = LongVideoAnalysisFramesSchema.parse(await bunFile(resolve(artifactsDir, 'frames.json')).json())
    const projectDir = resolve(artifactsDir, '..')
    const missing = await Promise.all(manifest.frames.map(async (frame) => {
      const exists = await bunFile(frame.path).exists()

      return exists ? null : {name: relative(projectDir, frame.path).split(sep).join('/'), reason: 'missing' as const}
    }))

    return missing.filter((issue): issue is ArtifactIntegrityMissingIssue => issue !== null)
  } catch {
    return []
  }
}

function summarizeArtifactIntegrity(result: {
  changed: ArtifactIntegrityChangedIssue[]
  checked: number
  missing: ArtifactIntegrityMissingIssue[]
  schemaInvalid: ArtifactSchemaInvalidIssue[]
  untracked: string[]
}): ArtifactIntegritySummary {
  const errors = result.changed.length + result.missing.length + result.schemaInvalid.length
  const warnings = result.untracked.length

  return {
    changed: result.changed.length,
    checked: result.checked,
    errors,
    missing: result.missing.length,
    schemaInvalid: result.schemaInvalid.length,
    untracked: result.untracked.length,
    warnings,
  }
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

function validateKnownArtifactSchema(name: string, content: Uint8Array): ArtifactSchemaInvalidIssue | undefined {
  const schema = findArtifactSchema(name)

  if (schema === undefined) {
    return undefined
  }

  let value: unknown

  try {
    value = JSON.parse(new TextDecoder().decode(content))
  } catch (error) {
    return {
      issues: [{
        code: 'invalid_json',
        message: error instanceof Error ? error.message : 'Invalid JSON',
        path: [],
      }],
      name,
    }
  }

  const result = schema.safeParse(value)

  if (result.success) {
    return undefined
  }

  return {
    issues: result.error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path.map(String),
    })),
    name,
  }
}

async function collectArtifactFiles(rootDir: string, currentDir: string): Promise<Array<{name: string; path: string}>> {
  const entries = await readdir(currentDir, {withFileTypes: true})
  const nested = await Promise.all(entries.map(async (entry): Promise<Array<{name: string; path: string}>> => {
    const path = join(currentDir, entry.name)

    if (entry.isDirectory()) {
      return collectArtifactFiles(rootDir, path)
    }

    if (!entry.isFile()) {
      return []
    }

    return [{
      name: toArtifactName(rootDir, path),
      path,
    }]
  }))

  return nested.flat()
}

function findArtifactSchema(name: string): ZodType | undefined {
  return ARTIFACT_SCHEMAS[name] ?? NESTED_ARTIFACT_SCHEMAS.find((item) => item.pattern.test(name))?.schema
}

function toArtifactName(rootDir: string, path: string): string {
  return relative(rootDir, path).split(sep).join('/')
}
