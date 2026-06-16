import {expect} from '#test/expect'
import {writeText} from '#test/fs'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

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
      await writeText(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath)
      await refreshArtifactManifest(artifactsDir)

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
      await writeText(inputPath, 'placeholder')
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

  it('fails with a checkpoint error when the artifact manifest is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))
    const projectDir = join(root, 'projects', 'demo')
    const artifactsDir = join(projectDir, 'artifacts')
    const inputPath = join(root, 'input.mp4')

    try {
      await mkdir(artifactsDir, {recursive: true})
      await writeText(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath)

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
      expect((error as PipelineCheckpointError).missingArtifacts).to.deep.equal(['artifact-manifest.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails with a checkpoint error when ingest side artifacts are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))
    const projectDir = join(root, 'projects', 'demo')
    const artifactsDir = join(projectDir, 'artifacts')
    const inputPath = join(root, 'input.mp4')

    try {
      await mkdir(artifactsDir, {recursive: true})
      await writeText(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['understand'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath, {
        artifacts: {
          sourceAudio: join(projectDir, 'audio', 'source.wav'),
        },
      })
      await refreshArtifactManifest(artifactsDir)

      let error: unknown

      try {
        await rerunProject('demo', {
          fromStage: 'understand',
          workspaceDir: root,
        })
      } catch (error_) {
        error = error_
      }

      expect(error).to.be.instanceOf(PipelineCheckpointError)
      expect((error as PipelineCheckpointError).fromStage).to.equal('understand')
      expect((error as PipelineCheckpointError).missingArtifacts).to.deep.equal(['audio/source.wav'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails with a checkpoint error when the ingest preview is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))
    const projectDir = join(root, 'projects', 'demo')
    const artifactsDir = join(projectDir, 'artifacts')
    const inputPath = join(root, 'input.mp4')

    try {
      await mkdir(artifactsDir, {recursive: true})
      await writeText(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['understand'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath, {
        artifacts: {
          preview: join(projectDir, 'renders', 'preview.mp4'),
        },
      })
      await refreshArtifactManifest(artifactsDir)

      let error: unknown

      try {
        await rerunProject('demo', {
          fromStage: 'understand',
          workspaceDir: root,
        })
      } catch (error_) {
        error = error_
      }

      expect(error).to.be.instanceOf(PipelineCheckpointError)
      expect((error as PipelineCheckpointError).fromStage).to.equal('understand')
      expect((error as PipelineCheckpointError).missingArtifacts).to.deep.equal(['renders/preview.mp4'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails with a checkpoint error when analysis frame manifest entries are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))
    const projectDir = join(root, 'projects', 'demo')
    const artifactsDir = join(projectDir, 'artifacts')
    const inputPath = join(root, 'input.mp4')

    try {
      await mkdir(artifactsDir, {recursive: true})
      await writeText(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['understand'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath)
      await writeText(
        join(artifactsDir, 'frames.json'),
        `${JSON.stringify({
          frameCount: 1,
          framePattern: join(projectDir, 'frames', 'frame_%05d.jpg'),
          frames: [
            {
              path: join(projectDir, 'frames', 'frame_00001.jpg'),
              timestamp: 0,
            },
          ],
          sampleFps: 1,
          source: inputPath,
          version: 1,
        })}\n`,
      )
      await refreshArtifactManifest(artifactsDir)

      let error: unknown

      try {
        await rerunProject('demo', {
          fromStage: 'understand',
          workspaceDir: root,
        })
      } catch (error_) {
        error = error_
      }

      expect(error).to.be.instanceOf(PipelineCheckpointError)
      expect((error as PipelineCheckpointError).fromStage).to.equal('understand')
      expect((error as PipelineCheckpointError).missingArtifacts).to.deep.equal(['frames/frame_00001.jpg'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails with a checkpoint error when TTS segment files are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))
    const projectDir = join(root, 'projects', 'demo')
    const artifactsDir = join(projectDir, 'artifacts')
    const inputPath = join(root, 'input.mp4')

    try {
      await mkdir(artifactsDir, {recursive: true})
      await writeText(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath)
      await refreshArtifactManifest(artifactsDir)
      await rm(join(projectDir, 'tts', 'narration-1.wav'), {force: true})

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
      expect((error as PipelineCheckpointError).missingArtifacts).to.deep.equal(['tts/narration-1.wav'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails with a checkpoint error when per-chunk artifacts are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))
    const projectDir = join(root, 'projects', 'demo')
    const artifactsDir = join(projectDir, 'artifacts')
    const inputPath = join(root, 'input.mp4')

    try {
      await mkdir(artifactsDir, {recursive: true})
      await writeText(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['plan'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath)
      await refreshArtifactManifest(artifactsDir)
      await rm(join(artifactsDir, 'chunks', '000', 'vlm.json'), {force: true})

      let error: unknown

      try {
        await rerunProject('demo', {
          fromStage: 'plan',
          workspaceDir: root,
        })
      } catch (error_) {
        error = error_
      }

      expect(error).to.be.instanceOf(PipelineCheckpointError)
      expect((error as PipelineCheckpointError).fromStage).to.equal('plan')
      expect((error as PipelineCheckpointError).missingArtifacts).to.deep.equal(['chunks/000/vlm.json'])
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
      await writeText(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath)
      await refreshArtifactManifest(artifactsDir)
      await writeText(join(artifactsDir, 'timeline.json'), '{"version":1,"duration":999,"fps":30,"items":[]}\n')

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
      await writeText(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['quality'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath)
      await writeText(join(artifactsDir, 'clip-plan.json'), '{"version":1,"duration":1,"source":"","sourceDuration":1,"clips":[]}\n')
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

  it('fails when checkpoint provider artifacts do not match their schemas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-rerun-'))
    const projectDir = join(root, 'projects', 'demo')
    const artifactsDir = join(projectDir, 'artifacts')
    const inputPath = join(root, 'input.mp4')

    try {
      await mkdir(artifactsDir, {recursive: true})
      await writeText(inputPath, 'placeholder')
      await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
        inputPath,
        projectId: 'demo',
        stages: ['plan'],
      })
      await writeRequiredArtifacts(artifactsDir, inputPath)
      await writeText(join(artifactsDir, 'transcript.json'), '{"text":"bad","segments":[{"start":2,"end":1,"text":"bad"}]}\n')
      await refreshArtifactManifest(artifactsDir)

      let error: unknown

      try {
        await rerunProject('demo', {
          fromStage: 'plan',
          workspaceDir: root,
        })
      } catch (error_) {
        error = error_
      }

      expect(error).to.be.instanceOf(PipelineCheckpointError)
      expect((error as PipelineCheckpointError).fromStage).to.equal('plan')
      expect((error as PipelineCheckpointError).schemaInvalidArtifacts).to.deep.equal(['transcript.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

interface WriteRequiredArtifactsOptions {
  artifacts?: Record<string, string>
}

async function writeRequiredArtifacts(artifactsDir: string, inputPath: string, options: WriteRequiredArtifactsOptions = {}): Promise<void> {
  await mkdir(join(dirname(artifactsDir), 'tts'), {recursive: true})

  await Promise.all([
    writeText(
      join(artifactsDir, 'ingest-report.json'),
      `${JSON.stringify({
        artifacts: options.artifacts ?? {},
        completedAt: '2026-01-01T00:00:00.000Z',
        inputPath,
        stage: 'ingest',
        version: 1,
      })}\n`,
    ),
    writeText(
      join(artifactsDir, 'media-info.json'),
      `${JSON.stringify({
        duration: 1,
        inputPath,
        probedAt: '2026-01-01T00:00:00.000Z',
        streams: [],
        version: 1,
      })}\n`,
    ),
    ...writeLongVideoArtifacts(artifactsDir, inputPath),
    writeText(
      join(artifactsDir, 'scene-analysis.json'),
      `${JSON.stringify([
        {
          description: 'scene',
          evidence: [],
          sceneId: 'scene-1',
        },
      ])}\n`,
    ),
    writeText(
      join(artifactsDir, 'scene-batches.json'),
      `${JSON.stringify([
        {
          frames: [],
          sceneId: 'scene-1',
          timeRange: [0, 1],
        },
      ])}\n`,
    ),
    writeText(
      join(artifactsDir, 'transcript.json'),
      `${JSON.stringify({
        segments: [],
        text: 'transcript',
      })}\n`,
    ),
    writeText(
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
    writeText(
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
    writeText(
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
    writeText(
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
    writeText(
      join(artifactsDir, 'tts-segments.json'),
      `${JSON.stringify([
        {
          duration: 1,
          narrationId: 'narration-1',
          path: 'tts/narration-1.wav',
        },
      ])}\n`,
    ),
    writeText(join(dirname(artifactsDir), 'tts', 'narration-1.wav'), 'placeholder wav'),
  ])
}

function writeLongVideoArtifacts(artifactsDir: string, inputPath: string): Array<Promise<void>> {
  const chunkSummary = {
    chunkId: 'chunk-000',
    contentRange: [0, 1],
    keyMoments: [
      {
        chunkId: 'chunk-000',
        evidence: [],
        id: 'chunk-000-moment-001',
        score: 0.5,
        sourceRange: [0, 1],
        summary: 'Test chunk moment.',
        title: 'Moment chunk-000',
      },
    ],
    silenceRanges: [],
    summary: 'Test chunk summary.',
  }
  const chapter = {
    chunkIds: ['chunk-000'],
    evidence: [],
    id: 'chapter-001',
    index: 0,
    keyMoments: chunkSummary.keyMoments,
    sourceRange: [0, 1],
    summary: chunkSummary.summary,
    title: 'Chapter 1',
  }

  return [
    writeText(
      join(artifactsDir, 'chunk-plan.json'),
      `${JSON.stringify({
        chunks: [
          {
            analysisRange: [0, 1],
            artifactPrefix: 'chunks/000',
            contentRange: [0, 1],
            duration: 1,
            id: 'chunk-000',
            index: 0,
          },
        ],
        defaults: {
          asrChunking: true,
          chunkDuration: 300,
          chunkOverlap: 10,
          frameSampleFps: 1,
          sceneDetection: true,
          vlmBatchSize: 16,
          vlmFrameSampleFps: 0.2,
        },
        source: inputPath,
        sourceDuration: 1,
        version: 1,
      })}\n`,
    ),
    writeText(
      join(artifactsDir, 'frames.json'),
      `${JSON.stringify({
        frameCount: 0,
        framePattern: 'frames/frame_%05d.jpg',
        frames: [],
        sampleFps: 1,
        source: inputPath,
        version: 1,
      })}\n`,
    ),
    writeText(
      join(artifactsDir, 'chunk-summaries.json'),
      `${JSON.stringify({
        chunks: [chunkSummary],
        source: inputPath,
        version: 1,
      })}\n`,
    ),
    writeText(
      join(artifactsDir, 'chapters.json'),
      `${JSON.stringify({
        chapters: [chapter],
        source: inputPath,
        version: 1,
      })}\n`,
    ),
    writeText(
      join(artifactsDir, 'global-outline.json'),
      `${JSON.stringify({
        chapters: [chapter],
        language: 'zh-CN',
        source: inputPath,
        sourceDuration: 1,
        storyBeats: [
          {
            chapterIds: ['chapter-001'],
            evidence: [],
            id: 'beat-001',
            sourceRange: [0, 1],
            summary: chapter.summary,
            title: chapter.title,
          },
        ],
        version: 1,
      })}\n`,
    ),
    writeText(
      join(artifactsDir, 'selected-moments.json'),
      `${JSON.stringify({
        moments: [
          {
            ...chunkSummary.keyMoments[0],
            reason: 'Test selection.',
          },
        ],
        source: inputPath,
        version: 1,
      })}\n`,
    ),
    writeJsonArtifact(artifactsDir, 'chunks/000/summary.json', chunkSummary),
    writeJsonArtifact(artifactsDir, 'chunks/000/silence.json', {
      chunkId: 'chunk-000',
      contentRange: [0, 1],
      silenceRanges: [],
      version: 1,
    }),
    writeJsonArtifact(artifactsDir, 'chunks/000/transcript.json', {
      segments: [],
      text: '',
    }),
    writeJsonArtifact(artifactsDir, 'chunks/000/vlm.json', []),
  ]
}

async function writeJsonArtifact(artifactsDir: string, name: string, value: unknown): Promise<void> {
  const path = join(artifactsDir, name)

  await mkdir(dirname(path), {recursive: true})
  await writeText(path, `${JSON.stringify(value)}\n`)
}
