import {expect} from '#test/expect'
import {writeText} from '#test/fs'
import {mkdir, mkdtemp, rm, unlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {refreshArtifactManifest} from '../../../packages/runtime/src/artifacts/store.js'
import {listProjectArtifacts, readProjectArtifact, verifyProjectArtifacts} from '../../../packages/runtime/src/artifacts/index.js'

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
      await writeText(join(artifactsDir, 'pipeline-events.jsonl'), `${JSON.stringify(createPipelineEvent())}\n`)
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

  it('reports ingest reports that fail their schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'ingest-report.json'), '{"version":1,"stage":"plan","inputPath":""}\n')
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.summary).to.deep.include({
        errors: 1,
        schemaInvalid: 1,
      })
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['ingest-report.json'])
      expect(result.schemaInvalid[0]?.issues.map((issue) => issue.path.join('.'))).to.include.members(['artifacts', 'inputPath', 'stage'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports quality reports that fail their schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'quality-report.json'), '{"version":1,"issues":[{"code":"","message":"bad","severity":"info"}],"summary":{"errors":-1,"warnings":0}}\n')
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.summary).to.deep.include({
        errors: 1,
        schemaInvalid: 1,
      })
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['quality-report.json'])
      expect(result.schemaInvalid[0]?.issues.map((issue) => issue.path.join('.'))).to.include.members(['issues.0.code', 'issues.0.severity', 'summary.errors'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports deck quality reports that fail their schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'deck-quality-report.json'), '{"version":1,"source":"deck.json","format":"portrait_1080x1920","summary":{"errors":-1,"warnings":0,"slides":1},"issues":[{"code":"","message":"bad","severity":"info"}],"metrics":[]}\n')
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.summary).to.deep.include({
        errors: 1,
        schemaInvalid: 1,
      })
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['deck-quality-report.json'])
      expect(result.schemaInvalid[0]?.issues.map((issue) => issue.path.join('.'))).to.include.members(['source', 'summary.errors', 'issues.0.code', 'issues.0.severity'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports deck normalization artifacts that fail their schemas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'claims.json'), '{"version":1,"claims":[{"id":"","blockId":"","text":"","type":"unknown","confidence":2}]}\n')
      await writeText(join(artifactsDir, 'source-quotes.json'), '{"version":1,"quotes":[{"id":"","blockId":"","text":""}]}\n')
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.summary).to.deep.include({
        errors: 2,
        schemaInvalid: 2,
      })
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['claims.json', 'source-quotes.json'])
      expect(result.schemaInvalid.flatMap((issue) => issue.issues.map((schemaIssue) => `${issue.name}:${schemaIssue.path.join('.')}`))).to.include.members([
        'claims.json:claims.0.id',
        'claims.json:claims.0.type',
        'claims.json:claims.0.confidence',
        'source-quotes.json:quotes.0.id',
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('accepts final-video deck keyframe artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')
      const keyframePath = join(projectDir, 'renders', 'deck-keyframes', 'keyframe-000001.jpg')

      await mkdir(join(projectDir, 'renders', 'deck-keyframes'), {recursive: true})
      await writeFile(keyframePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
      await writeText(join(artifactsDir, 'deck-keyframes.json'), `${JSON.stringify({
        captureMode: 'final-video',
        duration: 12,
        fps: 30,
        generatedAt: '2026-01-01T00:00:00.000Z',
        renderer: 'remotion',
        samples: [
          {
            capturedAt: '2026-01-01T00:00:00.000Z',
            frame: 181,
            label: 'slide-mid',
            ok: true,
            path: 'renders/deck-keyframes/keyframe-000001.jpg',
            sha256: 'fake-sha',
            size: 4,
            slideId: 'slide-001',
            time: 6,
          },
        ],
        source: 'timed-deck.json',
        version: 1,
        viewport: {height: 1080, width: 1920},
      })}\n`)
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(true)
      expect(result.summary.errors).to.equal(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports render outputs that fail their schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'render-output.json'), '{"renderer":"ffmpeg","version":1,"outputQuality":{"errors":-1,"warnings":0},"audioInputs":-1}\n')
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.summary).to.deep.include({
        errors: 1,
        schemaInvalid: 1,
      })
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['render-output.json'])
      expect(result.schemaInvalid[0]?.issues.map((issue) => issue.path.join('.'))).to.include.members(['audioInputs', 'outputQuality.errors'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports export outputs that fail their schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'export-output.json'), '{"version":1,"format":"archive","outputPath":"","sourcePath":"/tmp/final.mp4","cleanOutput":false,"requireQuality":false,"completedAt":"2026-01-01T00:00:00.000Z"}\n')
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.summary).to.deep.include({
        errors: 1,
        schemaInvalid: 1,
      })
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['export-output.json'])
      expect(result.schemaInvalid[0]?.issues.map((issue) => issue.path.join('.'))).to.include.members(['format', 'outputPath'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports voiceover plans that fail their schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'voiceover-plan.json'), '{"version":1,"generatedAt":"","segments":[{"index":-1,"start":0,"alignment":"bad","status":"available"}]}\n')
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.summary).to.deep.include({
        errors: 1,
        schemaInvalid: 1,
      })
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['voiceover-plan.json'])
      expect(result.schemaInvalid[0]?.issues.map((issue) => issue.path.join('.'))).to.include.members(['generatedAt', 'segments.0.alignment', 'segments.0.index'])
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

  it('reports missing render output side artifacts referenced by render-output.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'voiceover-plan.json'), `${JSON.stringify({
        generatedAt: '2026-01-01T00:00:00.000Z',
        segments: [],
        version: 1,
      })}\n`)
      await writeText(join(artifactsDir, 'render-output.json'), `${JSON.stringify({
        audioInputs: 0,
        outputPath: join(projectDir, 'renders', 'final.mp4'),
        outputQuality: {
          errors: 0,
          warnings: 0,
        },
        renderer: 'ffmpeg',
        reviewHtmlPath: join(projectDir, 'renders', 'review', 'index.html'),
        reviewReportPath: join(artifactsDir, 'review-report.json'),
        subtitlePath: join(projectDir, 'renders', 'subtitles.srt'),
        version: 1,
        visualQuality: {
          errors: 0,
          frameSamples: [
            {
              ok: true,
              path: join(projectDir, 'renders', 'final-frame-first.jpg'),
              timestamp: 0,
            },
          ],
          warnings: 0,
        },
        voiceoverPlanPath: join(artifactsDir, 'voiceover-plan.json'),
      })}\n`)
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.missing.map((issue) => issue.name)).to.include.members([
        'renders/final-frame-first.jpg',
        'renders/final.mp4',
        'renders/review/index.html',
        'artifacts/review-report.json',
        'renders/subtitles.srt',
      ])
      expect(result.summary).to.deep.include({
        errors: 5,
        missing: 5,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports missing export files referenced by export-output.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')
      const exportPath = join(root, 'exports', 'demo.mp4')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'export-output.json'), `${JSON.stringify({
        cleanOutput: false,
        completedAt: '2026-01-01T00:00:00.000Z',
        format: 'video',
        outputPath: exportPath,
        requireQuality: true,
        sourcePath: join(projectDir, 'renders', 'final.mp4'),
        version: 1,
      })}\n`)
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.missing.map((issue) => issue.name)).to.include.members([
        exportPath,
        'renders/final.mp4',
      ])
      expect(result.summary).to.deep.include({
        errors: 2,
        missing: 2,
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

  it('reports pipeline event logs that fail their JSONL schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'pipeline-events.jsonl'), '{"projectId":"demo","time":"","type":"stage:bogus"}\nnot json\n')
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['pipeline-events.jsonl'])
      expect(result.schemaInvalid[0]?.issues.map((issue) => issue.path.join('.'))).to.include.members(['1.time', '1.type', '2'])
      expect(result.summary).to.deep.include({
        errors: 1,
        schemaInvalid: 1,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports provider call logs that fail their JSONL schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-artifacts-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeText(join(artifactsDir, 'provider-calls.jsonl'), `${JSON.stringify({
        completedAt: '2026-01-01T00:00:00.000Z',
        durationMs: -1,
        input: {},
        operation: 'transcribe',
        provider: 'mock',
        requestId: 'asr_1',
        role: 'asr',
        startedAt: '2026-01-01T00:00:00.000Z',
        status: 'failed',
        version: 1,
      })}\n`)
      await refreshArtifactManifest(artifactsDir)

      const result = await verifyProjectArtifacts('demo', root)

      expect(result.ok).to.equal(false)
      expect(result.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['provider-calls.jsonl'])
      expect(result.schemaInvalid[0]?.issues.map((issue) => issue.path.join('.'))).to.include.members(['1.durationMs', '1.error'])
      expect(result.summary).to.deep.include({
        errors: 1,
        schemaInvalid: 1,
      })
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

function createPipelineEvent(): Record<string, unknown> {
  return {
    projectId: 'demo',
    stage: 'ingest',
    time: '2026-01-01T00:00:00.000Z',
    type: 'stage:start',
  }
}
