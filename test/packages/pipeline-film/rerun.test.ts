import {expect} from '#test/expect'
import {chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {runFilmRecapProject} from '../../../packages/pipeline-film/src/recovery/runner.js'
import {refreshArtifactManifest} from '../../../packages/runtime/src/artifacts/store.js'
import {readProjectEvents} from '../../../packages/runtime/src/project/events-reader.js'
import {writeConfig} from '../../../packages/runtime/src/shared/config.js'
import {PipelineCheckpointError} from '@video-agent/runtime'
import {rerunFilmProject} from '../../../packages/pipeline-film/src/rerun.js'

describe('rerun project', () => {
  it('reruns an existing film project from job state input path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))

    try {
      await createFilmQualityCheckpoint(root, 'demo')

      const result = await rerunFilmProject('demo', {
        fromStage: 'quality-check',
        workspaceDir: root,
      })

      expect(result.projectId).to.equal('demo')
      expect(result.fromStage).to.equal('quality-check')
      expect(result.completedStages).to.deep.equal(['quality-check'])
      expect(result.status).to.equal('completed')
      expect(result.quality?.artifactPath).to.contain('quality-report.json')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails with a checkpoint error when required artifacts are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))

    try {
      await createFilmQualityCheckpoint(root, 'demo', {writeArtifacts: false})

      const error = await catchRerun(root, 'demo')

      expect(error).to.be.instanceOf(PipelineCheckpointError)
      expect((error as PipelineCheckpointError).fromStage).to.equal('quality-check')
      expect((error as PipelineCheckpointError).missingArtifacts).to.include.members([
        'output-narration.json',
        'output-timeline-map.json',
        'render-output.json',
        'tts-segments.json',
      ])
      expect((error as PipelineCheckpointError).changedArtifacts).to.deep.equal([])
      expect((error as PipelineCheckpointError).untrackedArtifacts).to.deep.equal([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails with a checkpoint error when the artifact manifest is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))

    try {
      await createFilmQualityCheckpoint(root, 'demo', {refreshManifest: false})

      const error = await catchRerun(root, 'demo')

      expect(error).to.be.instanceOf(PipelineCheckpointError)
      expect((error as PipelineCheckpointError).fromStage).to.equal('quality-check')
      expect((error as PipelineCheckpointError).missingArtifacts).to.deep.equal(['artifact-manifest.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails with a checkpoint error when manifest-tracked artifacts changed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))

    try {
      const artifactsDir = await createFilmQualityCheckpoint(root, 'demo')
      await writeJson(artifactsDir, 'render-output.json', {
        completedAt: '2026-01-01T00:00:00.000Z',
        outputPath: 'renders/changed.mp4',
        renderer: 'ffmpeg',
        version: 1,
      })

      const error = await catchRerun(root, 'demo')

      expect(error).to.be.instanceOf(PipelineCheckpointError)
      expect((error as PipelineCheckpointError).fromStage).to.equal('quality-check')
      expect((error as PipelineCheckpointError).changedArtifacts).to.deep.equal(['render-output.json'])
      expect((error as PipelineCheckpointError).missingArtifacts).to.deep.equal([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails when checkpoint IR artifacts do not match their schemas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))

    try {
      const artifactsDir = await createFilmQualityCheckpoint(root, 'demo')
      await writeFile(join(artifactsDir, 'output-timeline-map.json'), '{"version":1,"source":"","outputDuration":1,"clips":[]}\n')
      await refreshArtifactManifest(artifactsDir)

      const error = await catchRerun(root, 'demo')

      expect(error).to.be.instanceOf(PipelineCheckpointError)
      expect((error as PipelineCheckpointError).fromStage).to.equal('quality-check')
      expect((error as PipelineCheckpointError).schemaInvalidArtifacts).to.deep.equal(['output-timeline-map.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('uses configured stage retries when running film stages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-retry-'))
    const inputPath = join(root, 'input.mp4')
    const binDir = join(root, 'bin')
    const statePath = join(root, 'ffprobe-attempts.txt')
    const originalPath = process.env.PATH

    try {
      await mkdir(binDir, {recursive: true})
      await writeConfig(root, {
        maxStageRetries: 1,
        retryBackoffMs: 0,
      })
      await writeFile(inputPath, 'placeholder')
      await writeFile(join(binDir, 'ffprobe'), createFlakyFfprobeScript(statePath))
      await chmod(join(binDir, 'ffprobe'), 0o755)

      process.env.PATH = `${binDir}:${originalPath ?? ''}`

      const error = await captureAsyncError(() => runFilmRecapProject({
        fromStage: 'ingest',
        inputPath,
        projectId: 'retry-demo',
        workspaceDir: root,
      }))
      const retryEvents = await readProjectEvents('retry-demo', {
        kind: 'pipeline',
        pipelineType: 'stage:retry',
        workspaceDir: root,
      })

      expect(error).to.be.instanceOf(Error)
      expect(await readFile(statePath, 'utf8')).to.equal('2\n')
      expect(retryEvents.events.map((event) => event.event.stage)).to.include('ingest')
    } finally {
      process.env.PATH = originalPath
      await rm(root, {force: true, recursive: true})
    }
  })

  it('generates a real project id before Film pipeline retry events instead of using a film fallback id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-generated-id-'))
    const inputPath = join(root, 'source clip.mp4')
    const binDir = join(root, 'bin')
    const statePath = join(root, 'ffprobe-attempts.txt')
    const originalPath = process.env.PATH

    try {
      await mkdir(binDir, {recursive: true})
      await writeConfig(root, {
        maxStageRetries: 1,
        retryBackoffMs: 0,
      })
      await writeFile(inputPath, 'placeholder')
      await writeFile(join(binDir, 'ffprobe'), createFlakyFfprobeScript(statePath))
      await chmod(join(binDir, 'ffprobe'), 0o755)

      process.env.PATH = `${binDir}:${originalPath ?? ''}`

      const error = await captureAsyncError(() => runFilmRecapProject({
        fromStage: 'ingest',
        inputPath,
        workspaceDir: root,
      }))
      const projectIds = await readdir(join(root, 'projects'))
      const projectId = projectIds[0]

      expect(error).to.be.instanceOf(Error)
      expect(projectIds).to.have.length(1)
      expect(projectId === 'film').to.equal(false)
      expect(projectId?.startsWith('source-clip-')).to.equal(true)

      const retryEvents = await readProjectEvents(projectId ?? '', {
        kind: 'pipeline',
        pipelineType: 'stage:retry',
        workspaceDir: root,
      })

      expect(retryEvents.events.length).to.be.greaterThan(0)
      expect(retryEvents.events.every((event) => event.event.projectId === projectId)).to.equal(true)
    } finally {
      process.env.PATH = originalPath
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function catchRerun(root: string, projectId: string): Promise<unknown> {
  return captureAsyncError(() => rerunFilmProject(projectId, {
    fromStage: 'quality-check',
    workspaceDir: root,
  }))
}

interface CreateFilmQualityCheckpointOptions {
  refreshManifest?: boolean
  writeArtifacts?: boolean
}

async function createFilmQualityCheckpoint(root: string, projectId: string, options: CreateFilmQualityCheckpointOptions = {}): Promise<string> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')
  const inputPath = join(root, 'input.mp4')

  await writeConfig(root, {})
  await mkdir(artifactsDir, {recursive: true})
  await writeFile(inputPath, 'placeholder')
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath,
    pipeline: 'film',
    projectId,
    stages: ['quality-check'],
  })

  if (options.writeArtifacts !== false) {
    await Promise.all([
      writeJson(artifactsDir, 'render-output.json', {
        completedAt: '2026-01-01T00:00:00.000Z',
        outputPath: 'renders/final.mp4',
        renderer: 'ffmpeg',
        version: 1,
      }),
      writeJson(artifactsDir, 'output-narration.json', {
        language: 'zh-CN',
        segments: [],
        timeline: 'output',
        version: 1,
      }),
      writeJson(artifactsDir, 'tts-segments.json', []),
      writeJson(artifactsDir, 'output-timeline-map.json', {
        clips: [],
        outputDuration: 1,
        source: inputPath,
        version: 1,
      }),
    ])
  }

  if (options.refreshManifest !== false) {
    await refreshArtifactManifest(artifactsDir)
  }

  return artifactsDir
}

async function writeJson(dir: string, name: string, value: unknown): Promise<void> {
  await writeFile(join(dir, name), `${JSON.stringify(value)}\n`)
}

async function captureAsyncError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (error) {
    return error
  }

  return undefined
}

function createFlakyFfprobeScript(statePath: string): string {
  return `#!/bin/sh
STATE=${shellSingleQuote(statePath)}
if [ ! -f "$STATE" ]; then
  printf '1\\n' > "$STATE"
  echo 'transient ffprobe failure' >&2
  exit 17
fi
printf '2\\n' > "$STATE"
cat <<'JSON'
{"format":{"duration":"1","format_name":"mov","size":"10"},"streams":[{"avg_frame_rate":"30/1","codec_name":"h264","codec_type":"video","duration":"1","height":180,"index":0,"width":320}]}
JSON
`
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`
}
