import {expect} from 'chai'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
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
    writeJson(artifactsDir, 'scene-analysis.json', []),
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
}

async function patchJobUpdatedAt(path: string, updatedAt: string): Promise<void> {
  const state = JSON.parse(await readFile(path, 'utf8')) as {updatedAt: string}

  await writeFile(path, `${JSON.stringify({...state, updatedAt}, null, 2)}\n`)
}

async function writeJson(dir: string, name: string, value: unknown): Promise<void> {
  await writeFile(join(dir, name), `${JSON.stringify(value)}\n`)
}
