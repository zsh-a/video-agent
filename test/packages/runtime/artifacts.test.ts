import {expect} from '#test/expect'
import {writeText} from '#test/fs'
import {mkdir, mkdtemp, rm, unlink} from 'node:fs/promises'
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
      await writeText(join(artifactsDir, 'media-info.json'), '{"version":1}\n')
      await writeText(join(artifactsDir, 'pipeline-events.jsonl'), '{}\n')
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

  it('tracks and validates nested chunk artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')
      const chunkDir = join(artifactsDir, 'chunks', '000')

      await mkdir(chunkDir, {recursive: true})
      await writeText(join(chunkDir, 'summary.json'), `${JSON.stringify({
        chunkId: 'chunk-000',
        contentRange: [0, 5],
        summary: 'Opening section.',
      })}\n`)
      await refreshArtifactManifest(artifactsDir)

      const artifacts = await listProjectArtifacts('demo', root)
      const summary = await readProjectArtifact('demo', 'chunks/000/summary.json', root)
      const integrity = await verifyProjectArtifacts('demo', root)

      expect(artifacts.map((artifact) => artifact.name)).to.deep.equal(['artifact-manifest.json', 'chunks/000/summary.json'])
      expect(summary.content).to.deep.equal({
        chunkId: 'chunk-000',
        contentRange: [0, 5],
        summary: 'Opening section.',
      })
      expect(integrity.ok).to.equal(true)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('verifies artifacts against the manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'media-info.json'), `${JSON.stringify(createMediaInfoArtifact())}\n`)
      await writeText(join(artifactsDir, 'pipeline-events.jsonl'), '{}\n')
      await refreshArtifactManifest(artifactsDir)

      expect(await verifyProjectArtifacts('demo', root)).to.include({
        checked: 2,
        ok: true,
      })
      expect((await verifyProjectArtifacts('demo', root)).summary).to.deep.equal({
        changed: 0,
        checked: 2,
        errors: 0,
        missing: 0,
        schemaInvalid: 0,
        untracked: 0,
        warnings: 0,
      })

      await writeText(join(artifactsDir, 'media-info.json'), '{"version":2}\n')
      await unlink(join(artifactsDir, 'pipeline-events.jsonl'))
      await writeText(join(artifactsDir, 'extra.json'), '{}\n')

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.changed.map((issue) => issue.name)).to.deep.equal(['media-info.json'])
      expect(result.missing.map((issue) => issue.name)).to.deep.equal(['pipeline-events.jsonl'])
      expect(result.summary).to.deep.equal({
        changed: 1,
        checked: 2,
        errors: 3,
        missing: 1,
        schemaInvalid: 1,
        untracked: 1,
        warnings: 1,
      })
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
      await writeText(join(artifactsDir, 'media-info.json'), '{"version":1}\n')
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.summary).to.deep.include({
        errors: 1,
        schemaInvalid: 1,
        warnings: 0,
      })
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['media-info.json'])
      expect(result.schemaInvalid[0]?.issues.map((issue) => issue.path.join('.'))).to.include('inputPath')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports long-video planning artifacts that fail their schemas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'chunk-plan.json'), '{"version":1,"source":"/tmp/long.mp4","sourceDuration":10,"defaults":{"chunkDuration":0},"chunks":[]}\n')
      await writeText(join(artifactsDir, 'frames.json'), '{"version":1,"source":"/tmp/long.mp4","framePattern":"frames/frame_%05d.jpg","sampleFps":1,"frameCount":2,"frames":[]}\n')
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['chunk-plan.json', 'frames.json'])
      expect(result.schemaInvalid[0]?.issues.map((issue) => issue.path.join('.'))).to.include('defaults.chunkDuration')
      expect(result.schemaInvalid[1]?.issues.map((issue) => issue.path.join('.'))).to.include('frameCount')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports missing analysis frame files referenced by frames.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'frames.json'), `${JSON.stringify({
        frameCount: 1,
        framePattern: join(projectDir, 'frames', 'frame_%05d.jpg'),
        frames: [
          {
            path: join(projectDir, 'frames', 'frame_00001.jpg'),
            timestamp: 0,
          },
        ],
        sampleFps: 1,
        source: '/tmp/long.mp4',
        version: 1,
      })}\n`)
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.missing).to.deep.equal([
        {
          name: 'frames/frame_00001.jpg',
          reason: 'missing',
        },
      ])
      expect(result.summary).to.deep.include({
        errors: 1,
        missing: 1,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports missing ingest side artifacts referenced by ingest-report.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'ingest-report.json'), `${JSON.stringify({
        artifacts: {
          preview: join(projectDir, 'renders', 'preview.mp4'),
          sourceAudio: 'audio/source.wav',
        },
        completedAt: '2026-01-01T00:00:00.000Z',
        inputPath: '/tmp/input.mp4',
        stage: 'ingest',
        version: 1,
      })}\n`)
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.missing).to.deep.equal([
        {
          name: 'audio/source.wav',
          reason: 'missing',
        },
        {
          name: 'renders/preview.mp4',
          reason: 'missing',
        },
      ])
      expect(result.summary).to.deep.include({
        errors: 2,
        missing: 2,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports missing TTS segment files referenced by tts-segments.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'tts-segments.json'), `${JSON.stringify([
        {
          duration: 1,
          narrationId: 'narration-1',
          path: 'tts/narration-1.wav',
        },
      ])}\n`)
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.missing).to.deep.equal([
        {
          name: 'tts/narration-1.wav',
          reason: 'missing',
        },
      ])
      expect(result.summary).to.deep.include({
        errors: 1,
        missing: 1,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports provider JSON artifacts that fail their schemas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'transcript.json'), '{"text":"bad","segments":[{"start":2,"end":1,"text":"bad"}]}\n')
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['transcript.json'])
      expect(result.schemaInvalid[0]?.issues.map((issue) => issue.path.join('.'))).to.include('segments.0.end')
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
