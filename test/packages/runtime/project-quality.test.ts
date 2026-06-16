import {expect} from '#test/expect'
import {writeText} from '#test/fs'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {refreshArtifactManifest} from '../../../packages/runtime/src/artifact-store.js'
import {readProjectQuality, readProjectQualityDetails} from '../../../packages/runtime/src/project-quality.js'

describe('project quality', () => {
  it('summarizes pipeline, render, and artifact quality', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      await createProject(root, 'demo')

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 4,
        warnings: 10,
      })
      expect(report.pipeline.errors).to.equal(1)
      expect(report.render.missingVoiceovers).to.equal(1)
      expect(report.artifacts.ok).to.equal(false)
      expect(report.artifacts.untracked).to.deep.equal(['untracked.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('can include raw quality artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      await createProject(root, 'demo')

      const report = await readProjectQualityDetails('demo', root)

      expect(report.qualityReport).to.be.an('object')
      expect(report.renderOutput).to.be.an('object')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('counts schema-invalid artifacts as project quality errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['ingest'],
      })
      await writeText(join(artifactsDir, 'media-info.json'), '{"version":1}\n')
      await refreshArtifactManifest(artifactsDir)

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 1,
        warnings: 0,
      })
      expect(report.artifacts.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['media-info.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('counts schema-invalid ingest reports as project quality errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['ingest'],
      })
      await writeText(join(artifactsDir, 'ingest-report.json'), '{"version":1,"stage":"plan","inputPath":""}\n')
      await refreshArtifactManifest(artifactsDir)

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 1,
        warnings: 0,
      })
      expect(report.artifacts.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['ingest-report.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('counts schema-invalid quality reports as project quality errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeText(join(artifactsDir, 'quality-report.json'), '{"version":1,"issues":[{"code":"","message":"bad","severity":"info"}],"summary":{"errors":-1,"warnings":0}}\n')
      await refreshArtifactManifest(artifactsDir)

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 1,
        warnings: 0,
      })
      expect(report.artifacts.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['quality-report.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('counts schema-invalid render outputs as project quality errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeText(join(artifactsDir, 'render-output.json'), '{"renderer":"ffmpeg","version":1,"outputQuality":{"errors":-1,"warnings":0},"audioInputs":-1}\n')
      await refreshArtifactManifest(artifactsDir)

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 1,
        warnings: 0,
      })
      expect(report.artifacts.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['render-output.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('counts schema-invalid export outputs as project quality errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeText(join(artifactsDir, 'export-output.json'), '{"version":1,"format":"archive","outputPath":"","sourcePath":"/tmp/final.mp4","cleanOutput":false,"requireQuality":false,"completedAt":"2026-01-01T00:00:00.000Z"}\n')
      await refreshArtifactManifest(artifactsDir)

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 1,
        warnings: 0,
      })
      expect(report.artifacts.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['export-output.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('counts schema-invalid voiceover plans as project quality errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeText(join(artifactsDir, 'voiceover-plan.json'), '{"version":1,"generatedAt":"","segments":[{"index":-1,"start":0,"alignment":"bad","status":"available"}]}\n')
      await refreshArtifactManifest(artifactsDir)

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 1,
        warnings: 0,
      })
      expect(report.artifacts.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['voiceover-plan.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('counts missing analysis frame references as project quality errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['ingest'],
      })
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
        source: '/tmp/input.mp4',
        version: 1,
      })}\n`)
      await refreshArtifactManifest(artifactsDir)

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 1,
        warnings: 0,
      })
      expect(report.artifacts.missing).to.deep.equal([
        {
          name: 'frames/frame_00001.jpg',
          reason: 'missing',
        },
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('counts missing ingest side artifact references as project quality errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['ingest'],
      })
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

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 2,
        warnings: 0,
      })
      expect(report.artifacts.missing).to.deep.equal([
        {
          name: 'audio/source.wav',
          reason: 'missing',
        },
        {
          name: 'renders/preview.mp4',
          reason: 'missing',
        },
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('counts missing TTS segment references as project quality errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['ingest'],
      })
      await writeText(join(artifactsDir, 'tts-segments.json'), `${JSON.stringify([
        {
          duration: 1,
          narrationId: 'narration-1',
          path: 'tts/narration-1.wav',
        },
      ])}\n`)
      await refreshArtifactManifest(artifactsDir)

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 1,
        warnings: 0,
      })
      expect(report.artifacts.missing).to.deep.equal([
        {
          name: 'tts/narration-1.wav',
          reason: 'missing',
        },
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('counts missing render output side artifacts as project quality errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeText(join(artifactsDir, 'render-output.json'), `${JSON.stringify({
        audioInputs: 0,
        outputPath: join(projectDir, 'renders', 'final.mp4'),
        outputQuality: {
          errors: 0,
          warnings: 0,
        },
        renderer: 'ffmpeg',
        version: 1,
      })}\n`)
      await refreshArtifactManifest(artifactsDir)

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 1,
        warnings: 0,
      })
      expect(report.artifacts.missing).to.deep.equal([
        {
          name: 'renders/final.mp4',
          reason: 'missing',
        },
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('counts missing export output files as project quality errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeText(join(artifactsDir, 'export-output.json'), `${JSON.stringify({
        cleanOutput: false,
        completedAt: '2026-01-01T00:00:00.000Z',
        format: 'video',
        outputPath: join(projectDir, 'exports', 'demo.mp4'),
        requireQuality: true,
        sourcePath: join(projectDir, 'renders', 'final.mp4'),
        version: 1,
      })}\n`)
      await refreshArtifactManifest(artifactsDir)

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 2,
        warnings: 0,
      })
      expect(report.artifacts.missing).to.deep.equal([
        {
          name: 'exports/demo.mp4',
          reason: 'missing',
        },
        {
          name: 'renders/final.mp4',
          reason: 'missing',
        },
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('counts schema-invalid JSONL event logs as project quality errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      const projectDir = join(root, 'projects', 'demo')
      const artifactsDir = join(projectDir, 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeText(join(artifactsDir, 'pipeline-events.jsonl'), '{"projectId":"demo","time":"","type":"stage:bogus"}\n')
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

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 2,
        warnings: 0,
      })
      expect(report.artifacts.schemaInvalid.map((issue) => issue.name)).to.deep.equal(['pipeline-events.jsonl', 'provider-calls.jsonl'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function createProject(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')

  await mkdir(artifactsDir, {recursive: true})
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath: '/tmp/input.mp4',
    projectId,
    stages: ['ingest', 'quality'],
  })
  await writeText(
    join(artifactsDir, 'quality-report.json'),
    `${JSON.stringify({
      issues: [
        {
          code: 'timeline.item.out_of_bounds',
          message: 'bad timeline',
          severity: 'error',
        },
        {
          code: 'tts.segment.missing',
          message: 'missing voiceover',
          severity: 'warning',
        },
      ],
      summary: {
        errors: 1,
        warnings: 1,
      },
      version: 1,
    })}\n`,
  )
  await writeText(
    join(artifactsDir, 'render-output.json'),
    `${JSON.stringify({
      audioDiagnostics: {
        missingVoiceovers: [{index: 0, reason: 'missing'}],
        warnings: ['audio warning'],
      },
      audioInputs: 1,
      audioQuality: {
        errors: 0,
        warnings: 1,
      },
      outputQuality: {
        errors: 1,
        warnings: 1,
      },
      renderer: 'ffmpeg',
      subtitleQuality: {
        errors: 0,
        warnings: 1,
      },
      templateQuality: {
        errors: 1,
        warnings: 2,
      },
      version: 1,
      visualQuality: {
        errors: 1,
        warnings: 1,
      },
    })}\n`,
  )
  await refreshArtifactManifest(artifactsDir)
  await writeText(join(artifactsDir, 'untracked.json'), '{}\n')
}
