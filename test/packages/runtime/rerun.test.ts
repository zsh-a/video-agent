import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {refreshArtifactManifest} from '../../../packages/runtime/src/artifact-store.js'
import {PipelineCheckpointError} from '../../../packages/runtime/src/job-runner.js'
import {rerunProject} from '../../../packages/runtime/src/rerun.js'

describe('rerun project', () => {
  it('reruns an existing project from job state input path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))
    const projectDir = join(root, 'projects', 'demo')
    const artifactsDir = join(projectDir, 'artifacts')
    const inputPath = join(root, 'input.mp4')

    try {
      await mkdir(artifactsDir, {recursive: true})
      await writeFile(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath)

      const result = await rerunProject('demo', {
        fromStage: 'quality',
        workspaceDir: root,
      })

      expect(result.projectId).to.equal('demo')
      expect(result.status).to.equal('completed')
      expect(result.artifacts.qualityReport).to.contain('quality-report.json')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails with a checkpoint error when required artifacts are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))
    const projectDir = join(root, 'projects', 'demo')
    const artifactsDir = join(projectDir, 'artifacts')
    const inputPath = join(root, 'input.mp4')

    try {
      await mkdir(artifactsDir, {recursive: true})
      await writeFile(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['quality'],
      })

      let error: unknown

      try {
        await rerunProject('demo', {
          fromStage: 'quality',
          workspaceDir: root,
        })
      } catch (error_) {
        error = error_
      }

      expect(error).to.be.instanceOf(PipelineCheckpointError)
      expect((error as PipelineCheckpointError).fromStage).to.equal('quality')
      expect((error as PipelineCheckpointError).missingArtifacts).to.include.members(['ingest-report.json', 'tts-segments.json'])
      expect((error as PipelineCheckpointError).changedArtifacts).to.deep.equal([])
      expect((error as PipelineCheckpointError).untrackedArtifacts).to.deep.equal([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails with a checkpoint error when manifest-tracked artifacts changed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))
    const projectDir = join(root, 'projects', 'demo')
    const artifactsDir = join(projectDir, 'artifacts')
    const inputPath = join(root, 'input.mp4')

    try {
      await mkdir(artifactsDir, {recursive: true})
      await writeFile(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath)
      await refreshArtifactManifest(artifactsDir)
      await writeFile(join(artifactsDir, 'timeline.json'), '{"version":1,"duration":999,"fps":30,"items":[]}\n')

      let error: unknown

      try {
        await rerunProject('demo', {
          fromStage: 'quality',
          workspaceDir: root,
        })
      } catch (error_) {
        error = error_
      }

      expect(error).to.be.instanceOf(PipelineCheckpointError)
      expect((error as PipelineCheckpointError).fromStage).to.equal('quality')
      expect((error as PipelineCheckpointError).changedArtifacts).to.deep.equal(['timeline.json'])
      expect((error as PipelineCheckpointError).missingArtifacts).to.deep.equal([])
      expect((error as PipelineCheckpointError).untrackedArtifacts).to.deep.equal([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails when checkpoint IR artifacts do not match their schemas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))
    const projectDir = join(root, 'projects', 'demo')
    const artifactsDir = join(projectDir, 'artifacts')
    const inputPath = join(root, 'input.mp4')

    try {
      await mkdir(artifactsDir, {recursive: true})
      await writeFile(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath)
      await writeFile(join(artifactsDir, 'clip-plan.json'), '{"version":1,"duration":1,"source":"","sourceDuration":1,"clips":[]}\n')
      await refreshArtifactManifest(artifactsDir)

      let error: unknown

      try {
        await rerunProject('demo', {
          fromStage: 'quality',
          workspaceDir: root,
        })
      } catch (error_) {
        error = error_
      }

      expect(error).to.be.instanceOf(PipelineCheckpointError)
      expect((error as PipelineCheckpointError).fromStage).to.equal('quality')
      expect((error as PipelineCheckpointError).schemaInvalidArtifacts).to.deep.equal(['clip-plan.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function writeRequiredArtifacts(artifactsDir: string, inputPath: string): Promise<void> {
  await Promise.all([
    writeFile(
      join(artifactsDir, 'ingest-report.json'),
      `${JSON.stringify({
        artifacts: {},
        completedAt: '2026-01-01T00:00:00.000Z',
        inputPath,
        stage: 'ingest',
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'media-info.json'),
      `${JSON.stringify({
        duration: 1,
        inputPath,
        probedAt: '2026-01-01T00:00:00.000Z',
        streams: [],
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'scene-analysis.json'),
      `${JSON.stringify([
        {
          description: 'scene',
          evidence: [],
          sceneId: 'scene-1',
        },
      ])}\n`,
    ),
    writeFile(
      join(artifactsDir, 'transcript.json'),
      `${JSON.stringify({
        segments: [],
        text: 'transcript',
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'storyboard.json'),
      `${JSON.stringify({
        language: 'zh-CN',
        scenes: [
          {
            duration: 1,
            evidence: [],
            id: 'scene-1',
            start: 0,
            visualStyle: 'documentary',
          },
        ],
        targetPlatform: 'generic',
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'clip-plan.json'),
      `${JSON.stringify({
        clips: [
          {
            duration: 1,
            id: 'clip-1',
            sceneId: 'scene-1',
            source: inputPath,
            sourceRange: [0, 1],
            start: 0,
          },
        ],
        duration: 1,
        source: inputPath,
        sourceDuration: 1,
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'timeline.json'),
      `${JSON.stringify({
        duration: 1,
        fps: 30,
        items: [
          {
            duration: 1,
            id: 'video-1',
            source: inputPath,
            sourceRange: [0, 1],
            start: 0,
            track: 'video',
          },
        ],
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'narration.json'),
      `${JSON.stringify({
        language: 'zh-CN',
        segments: [
          {
            duration: 1,
            id: 'narration-1',
            start: 0,
            text: 'hello',
          },
        ],
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'tts-segments.json'),
      `${JSON.stringify([
        {
          duration: 1,
          narrationId: 'narration-1',
          path: 'tts/narration-1.wav',
        },
      ])}\n`,
    ),
  ])
}
