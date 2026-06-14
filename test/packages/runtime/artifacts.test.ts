import {expect} from 'chai'
import {mkdir, mkdtemp, rm, unlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {refreshArtifactManifest} from '../../../packages/runtime/src/artifact-store.js'
import {listProjectArtifacts, readProjectArtifact, verifyProjectArtifacts} from '../../../packages/runtime/src/artifacts.js'

describe('artifacts', () => {
  it('lists and reads project artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeFile(join(artifactsDir, 'media-info.json'), '{"version":1}\n')
      await writeFile(join(artifactsDir, 'pipeline-events.jsonl'), '{}\n')
      await refreshArtifactManifest(artifactsDir)

      const artifacts = await listProjectArtifacts('demo', root)
      const mediaInfo = await readProjectArtifact('demo', 'media-info.json', root)

      expect(artifacts.map((artifact) => artifact.name)).to.deep.equal(['artifact-manifest.json', 'media-info.json', 'pipeline-events.jsonl'])
      expect(artifacts.find((artifact) => artifact.name === 'media-info.json')?.sha256).to.match(/^[a-f0-9]{64}$/)
      expect(mediaInfo.artifact.sha256).to.match(/^[a-f0-9]{64}$/)
      expect(mediaInfo.content).to.deep.equal({version: 1})
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('verifies artifacts against the manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeFile(join(artifactsDir, 'media-info.json'), `${JSON.stringify(createMediaInfoArtifact())}\n`)
      await writeFile(join(artifactsDir, 'pipeline-events.jsonl'), '{}\n')
      await refreshArtifactManifest(artifactsDir)

      expect(await verifyProjectArtifacts('demo', root)).to.include({
        checked: 2,
        ok: true,
      })

      await writeFile(join(artifactsDir, 'media-info.json'), '{"version":2}\n')
      await unlink(join(artifactsDir, 'pipeline-events.jsonl'))
      await writeFile(join(artifactsDir, 'extra.json'), '{}\n')

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.changed.map((issue) => issue.name)).to.deep.equal(['media-info.json'])
      expect(result.missing.map((issue) => issue.name)).to.deep.equal(['pipeline-events.jsonl'])
      expect(result.untracked).to.deep.equal(['extra.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports known JSON artifacts that fail their schemas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeFile(join(artifactsDir, 'media-info.json'), '{"version":1}\n')
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['media-info.json'])
      expect(result.schemaInvalid[0]?.issues.map((issue) => issue.path.join('.'))).to.include('inputPath')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects paths outside the artifact directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      let error: unknown

      try {
        await readProjectArtifact('demo', '../job-state.json', root)
      } catch (error_) {
        error = error_
      }

      expect(error).to.be.instanceOf(Error)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

function createMediaInfoArtifact(): Record<string, unknown> {
  return {
    duration: 1,
    inputPath: '/tmp/input.mp4',
    probedAt: '2026-01-01T00:00:00.000Z',
    streams: [],
    version: 1,
  }
}
