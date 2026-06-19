import type {ArtifactManifest} from './store.js'
import type {ArtifactIntegrityChangedIssue, ArtifactIntegrityMissingIssue, ArtifactIntegrityResult, ArtifactIntegritySummary, ArtifactSchemaInvalidIssue} from './index.js'

import {createHash} from 'node:crypto'
import {stat} from 'node:fs/promises'
import {resolve} from 'node:path'

import {ARTIFACT_MANIFEST_NAME} from './store.js'
import {bunFile} from '../shared/bun-runtime.js'
import {readOptionalJson} from '../shared/file-io.js'
import {collectArtifactFiles} from './files.js'
import {findMissingArtifactReferences} from './reference-integrity.js'
import {validateKnownArtifactSchema} from './schemas.js'
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

  missing.push(...await findMissingArtifactReferences(artifactsDir))

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
