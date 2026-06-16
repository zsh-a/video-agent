import {expect} from '#test/expect'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {refreshArtifactManifest} from '../../../packages/runtime/src/artifact-store.js'
import {recoverWorkspaceJobs} from '../../../packages/runtime/src/worker.js'

describe('workspace worker recovery', () => {
  it('lists recoverable jobs in dry-run mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-worker-'))

    try {
      await createRecoverableProject(root, 'demo')

      const report = await recoverWorkspaceJobs({
        dryRun: true,
        workspaceDir: root,
      })

      expect(report.recovered).to.equal(0)
      expect(report.results.find((result) => result.projectId === 'demo')).to.include({
        attempt: 1,
        fromStage: 'quality',
        jobStatus: 'failed',
        projectId: 'demo',
        status: 'would-recover',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('recovers a failed job from the first failed stage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-worker-'))

    try {
      await createRecoverableProject(root, 'demo')

      const report = await recoverWorkspaceJobs({workspaceDir: root})

      expect(report.recovered).to.equal(1)
      expect(report.results[0]?.status).to.equal('recovered')
      expect(report.results[0]?.fromStage).to.equal('quality')
      expect(report.results[0]?.result?.status).to.equal('completed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('skips recoverable jobs that reached the attempt limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-worker-'))

    try {
      await createRecoverableProject(root, 'demo')

      const report = await recoverWorkspaceJobs({
        dryRun: true,
        maxAttempts: 1,
        workspaceDir: root,
      })

      expect(report.recovered).to.equal(0)
      expect(report.skipped).to.equal(1)
      expect(report.results.find((result) => result.projectId === 'demo')).to.include({
        attempt: 1,
        fromStage: 'quality',
        jobStatus: 'failed',
        projectId: 'demo',
        skipReason: 'attempt-limit',
        status: 'skipped',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports recoverable jobs deferred by the processing limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-worker-'))

    try {
      await createRecoverableProject(root, 'demo-a')
      await createRecoverableProject(root, 'demo-b')

      const report = await recoverWorkspaceJobs({
        dryRun: true,
        limit: 1,
        workspaceDir: root,
      })

      expect(report.results.filter((result) => result.status === 'would-recover')).to.have.length(1)
      expect(report.results.filter((result) => result.skipReason === 'limit')).to.have.length(1)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('orders recovery candidates before applying the processing limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-worker-'))

    try {
      await createRecoverableProject(root, 'demo-new', {
        attempt: 1,
        updatedAt: '2026-01-02T00:00:00.000Z',
      })
      await createRecoverableProject(root, 'demo-old', {
        attempt: 3,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })

      const oldest = await recoverWorkspaceJobs({
        dryRun: true,
        limit: 1,
        orderBy: 'oldest',
        workspaceDir: root,
      })
      const byAttempt = await recoverWorkspaceJobs({
        dryRun: true,
        limit: 1,
        orderBy: 'attempt',
        workspaceDir: root,
      })

      expect(oldest.results.find((result) => result.status === 'would-recover')?.projectId).to.equal('demo-old')
      expect(byAttempt.results.find((result) => result.status === 'would-recover')?.projectId).to.equal('demo-old')
      expect(oldest.results.find((result) => result.skipReason === 'limit')?.projectId).to.equal('demo-new')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('skips recently updated running jobs when a stale threshold is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-worker-'))

    try {
      await createRecoverableProject(root, 'demo', {
        stageStatus: 'running',
        updatedAt: new Date().toISOString(),
      })

      const report = await recoverWorkspaceJobs({
        dryRun: true,
        runningStaleAfterMs: 60_000,
        statuses: ['running'],
        workspaceDir: root,
      })

      expect(report.recovered).to.equal(0)
      expect(report.skipped).to.equal(1)
      expect(report.results).to.deep.include({
        attempt: 1,
        fromStage: 'quality',
        jobStatus: 'running',
        projectId: 'demo',
        skipReason: 'running-active',
        status: 'skipped',
        updatedAt: report.results[0]?.updatedAt,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('skips recovery when checkpoint artifacts are incomplete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-worker-'))

    try {
      await createRecoverableProject(root, 'demo')
      await rm(join(root, 'projects', 'demo', 'artifacts', 'tts-segments.json'), {force: true})

      const report = await recoverWorkspaceJobs({
        dryRun: true,
        workspaceDir: root,
      })

      const result = report.results.find((item) => item.projectId === 'demo')

      expect(report.recovered).to.equal(0)
      expect(report.skipped).to.equal(1)
      expect(result).to.include({
        attempt: 1,
        fromStage: 'quality',
        jobStatus: 'failed',
        projectId: 'demo',
        skipReason: 'checkpoint-invalid',
        status: 'skipped',
      })
      expect(result?.missingArtifacts).to.deep.equal(['tts-segments.json'])
      expect(result?.error).to.include('Cannot resume from quality')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('skips recovery when checkpoint IR artifacts fail schema validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-worker-'))

    try {
      await createRecoverableProject(root, 'demo')
      await writeFile(join(root, 'projects', 'demo', 'artifacts', 'clip-plan.json'), '{"version":1,"duration":1,"source":"","sourceDuration":1,"clips":[]}\n')

      const report = await recoverWorkspaceJobs({
        dryRun: true,
        workspaceDir: root,
      })
      const result = report.results.find((item) => item.projectId === 'demo')

      expect(report.recovered).to.equal(0)
      expect(report.skipped).to.equal(1)
      expect(result).to.include({
        attempt: 1,
        fromStage: 'quality',
        jobStatus: 'failed',
        projectId: 'demo',
        skipReason: 'checkpoint-invalid',
        status: 'skipped',
      })
      expect(result?.error).to.include('schema invalid: clip-plan.json')
      expect(result?.schemaInvalidArtifacts).to.deep.equal(['clip-plan.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

interface CreateRecoverableProjectOptions {
  attempt?: number
  stageStatus?: 'failed' | 'running'
  updatedAt?: string
}

async function createRecoverableProject(root: string, projectId: string, options: CreateRecoverableProjectOptions = {}): Promise<void> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')
  const inputPath = join(root, `${projectId}.mp4`)
  const stageStatus = options.stageStatus ?? 'failed'

  await mkdir(artifactsDir, {recursive: true})
  await writeFile(inputPath, 'placeholder')
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath,
    projectId,
    stages: ['quality'],
  })
  await new JsonJobStore(join(projectDir, 'job-state.json')).updateStage('quality', stageStatus, 'previous failure', options.attempt ?? 1)

  if (options.updatedAt !== undefined) {
    await patchJobUpdatedAt(join(projectDir, 'job-state.json'), options.updatedAt)
  }

  await Promise.all([
    writeJson(artifactsDir, 'ingest-report.json', {
      artifacts: {},
      completedAt: '2026-01-01T00:00:00.000Z',
      inputPath,
      stage: 'ingest',
      version: 1,
    }),
    writeJson(artifactsDir, 'media-info.json', {
      duration: 1,
      inputPath,
      probedAt: '2026-01-01T00:00:00.000Z',
      streams: [],
      version: 1,
    }),
    ...writeLongVideoArtifacts(artifactsDir, inputPath),
    writeJson(artifactsDir, 'scene-analysis.json', []),
    writeJson(artifactsDir, 'scene-batches.json', []),
    writeJson(artifactsDir, 'transcript.json', {
      segments: [],
      text: '',
    }),
    writeJson(artifactsDir, 'storyboard.json', {
      language: 'zh-CN',
      scenes: [],
      targetPlatform: 'generic',
      version: 1,
    }),
    writeJson(artifactsDir, 'clip-plan.json', {
      clips: [],
      duration: 1,
      source: inputPath,
      sourceDuration: 1,
      version: 1,
    }),
    writeJson(artifactsDir, 'timeline.json', {
      duration: 1,
      fps: 30,
      items: [],
      version: 1,
    }),
    writeJson(artifactsDir, 'narration.json', {
      language: 'zh-CN',
      segments: [],
      version: 1,
    }),
    writeJson(artifactsDir, 'tts-segments.json', []),
  ])
  await refreshArtifactManifest(artifactsDir)
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
    writeJson(artifactsDir, 'chunk-plan.json', {
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
    }),
    writeJson(artifactsDir, 'frames.json', {
      frameCount: 0,
      framePattern: 'frames/frame_%05d.jpg',
      frames: [],
      sampleFps: 1,
      source: inputPath,
      version: 1,
    }),
    writeJson(artifactsDir, 'chunk-summaries.json', {
      chunks: [chunkSummary],
      source: inputPath,
      version: 1,
    }),
    writeJson(artifactsDir, 'chapters.json', {
      chapters: [chapter],
      source: inputPath,
      version: 1,
    }),
    writeJson(artifactsDir, 'global-outline.json', {
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
    }),
    writeJson(artifactsDir, 'selected-moments.json', {
      moments: [
        {
          ...chunkSummary.keyMoments[0],
          reason: 'Test selection.',
        },
      ],
      source: inputPath,
      version: 1,
    }),
    writeJson(artifactsDir, 'chunks/000/summary.json', chunkSummary),
    writeJson(artifactsDir, 'chunks/000/silence.json', {
      chunkId: 'chunk-000',
      contentRange: [0, 1],
      silenceRanges: [],
      version: 1,
    }),
    writeJson(artifactsDir, 'chunks/000/transcript.json', {
      segments: [],
      text: '',
    }),
    writeJson(artifactsDir, 'chunks/000/vlm.json', []),
  ]
}

async function patchJobUpdatedAt(path: string, updatedAt: string): Promise<void> {
  const state = JSON.parse(await readFile(path, 'utf8')) as {updatedAt: string}

  await writeFile(path, `${JSON.stringify({...state, updatedAt}, null, 2)}\n`)
}

async function writeJson(dir: string, name: string, value: unknown): Promise<void> {
  const path = join(dir, name)

  await mkdir(dirname(path), {recursive: true})
  await writeFile(path, `${JSON.stringify(value)}\n`)
}
