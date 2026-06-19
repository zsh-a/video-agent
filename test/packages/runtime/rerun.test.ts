import {expect} from '#test/expect'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {refreshArtifactManifest} from '../../../packages/runtime/src/artifact-store.js'
import {PipelineCheckpointError} from '../../../packages/runtime/src/checkpoint.js'
import {rerunProject} from '../../../packages/runtime/src/rerun.js'

describe('rerun project', () => {
  it('reruns an existing film project from job state input path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))

    try {
      await createFilmQualityCheckpoint(root, 'demo')

      const result = await rerunProject('demo', {
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
        'narration.json',
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
})

async function catchRerun(root: string, projectId: string): Promise<unknown> {
  try {
    await rerunProject(projectId, {
      fromStage: 'quality-check',
      workspaceDir: root,
    })
  } catch (error) {
    return error
  }

  return undefined
}

interface CreateFilmQualityCheckpointOptions {
  refreshManifest?: boolean
  writeArtifacts?: boolean
}

async function createFilmQualityCheckpoint(root: string, projectId: string, options: CreateFilmQualityCheckpointOptions = {}): Promise<string> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')
  const inputPath = join(root, 'input.mp4')

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
      writeJson(artifactsDir, 'narration.json', {
        language: 'zh-CN',
        segments: [],
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
