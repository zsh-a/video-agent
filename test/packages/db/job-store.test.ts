import {expect} from '#test/expect'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {BunSqliteJobStore} from '../../../packages/db/src/sqlite-job-store.js'

describe('job store', () => {
  it('persists job stage state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-job-store-'))

    try {
      const store = new JsonJobStore(join(root, 'job-state.json'))

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest', 'quality'],
      })
      await store.updateStage('ingest', 'running', undefined, 1)
      await store.updateStage('ingest', 'completed', undefined, 1)
      await store.complete('completed')

      const state = await store.read()

      expect(state.status).to.equal('completed')
      expect(state.pipeline).to.equal('film')
      expect(state.stages[0]).to.include({
        attempt: 1,
        name: 'ingest',
        status: 'completed',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects JSON job state without a pipeline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-job-store-missing-pipeline-'))

    try {
      const store = new JsonJobStore(join(root, 'job-state.json'))

      await writeFile(join(root, 'job-state.json'), `${JSON.stringify({
        createdAt: '2026-01-01T00:00:00.000Z',
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: [{name: 'ingest', status: 'pending'}],
        status: 'running',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
      })}\n`)

      const error = await captureAsyncError(() => store.read())

      expect(error?.message).to.equal('Job state pipeline must be a non-empty string.')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects malformed JSON job state before state normalization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-job-store-malformed-json-'))

    try {
      const store = new JsonJobStore(join(root, 'job-state.json'))

      await writeFile(join(root, 'job-state.json'), 'not json\n')

      const error = await captureAsyncError(() => store.read())

      expect(error?.message).to.contain('Job state file')
      expect(error?.message).to.contain('is invalid JSON')
      expect(error?.message).to.contain('no job-state parse fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('clears stale completion metadata when a JSON stage is rerun', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-job-store-rerun-'))

    try {
      const store = new JsonJobStore(join(root, 'job-state.json'))

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest'],
      })
      await store.updateStage('ingest', 'running', undefined, 1)
      await store.updateStage('ingest', 'completed', undefined, 1)
      await store.complete('completed')
      await store.updateStage('ingest', 'running', undefined, 2)

      const state = await store.read()
      const stage = state.stages[0]

      expect(state.status).to.equal('running')
      expect(state.completedAt).to.equal(undefined)
      expect(stage).to.include({
        attempt: 2,
        name: 'ingest',
        status: 'running',
      })
      expect(stage?.completedAt).to.equal(undefined)
      expect(stage?.message).to.equal(undefined)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('marks JSON jobs completed when all stages complete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-job-store-auto-complete-'))

    try {
      const store = new JsonJobStore(join(root, 'job-state.json'))

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest', 'quality'],
      })
      await store.updateStage('ingest', 'completed', undefined, 1)
      await store.updateStage('quality', 'completed', undefined, 1)

      const state = await store.read()

      expect(state.status).to.equal('completed')
      expect(state.completedAt).to.be.a('string')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('marks JSON jobs completed when remaining stages are skipped', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-job-store-skip-'))

    try {
      const store = new JsonJobStore(join(root, 'job-state.json'))

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest', 'transcribe'],
      })
      await store.updateStage('ingest', 'completed', undefined, 1)
      await store.updateStage('transcribe', 'skipped', 'Text input', 1)

      const state = await store.read()

      expect(state.status).to.equal('completed')
      expect(state.stages.find((stage) => stage.name === 'transcribe')).to.deep.include({
        message: 'Text input',
        status: 'skipped',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects JSON stage updates for unknown stages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-job-store-unknown-stage-'))

    try {
      const store = new JsonJobStore(join(root, 'job-state.json'))

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest'],
      })

      const stageError = await captureAsyncError(() => store.updateStage('missing', 'completed', undefined, 1))
      const progressError = await captureAsyncError(() => store.updateStageProgress('missing', {percent: 50}))

      expect(stageError?.message).to.equal('Job stage not found: missing')
      expect(progressError?.message).to.equal('Job stage not found: missing')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects invalid JSON job progress before persisting unreadable state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-job-store-invalid-progress-'))

    try {
      const store = new JsonJobStore(join(root, 'job-state.json'))

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest'],
      })

      const percentError = await captureAsyncError(() => store.updateStageProgress('ingest', {percent: 150}))
      const currentError = await captureAsyncError(() => store.updateStageProgress('ingest', {current: 3, total: 2}))
      const messageError = await captureAsyncError(() => store.updateStageProgress('ingest', {message: ''}))

      expect(percentError?.message).to.include('percent must be between 0 and 100')
      expect(currentError?.message).to.include('current (3) must not exceed total (2)')
      expect(messageError?.message).to.include('message must be a non-empty string')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('persists job stage state in SQLite when running on Bun', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-sqlite-job-store-'))

    try {
      const store = new BunSqliteJobStore(join(root, 'state.db'), 'demo')

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest', 'quality'],
      })
      await store.updateStage('ingest', 'running', undefined, 1)
      await store.updateStage('ingest', 'completed', undefined, 1)
      await store.complete('completed')

      const state = await store.read()

      expect(state.status).to.equal('completed')
      expect(state.pipeline).to.equal('film')
      expect(state.stages[0]).to.include({
        attempt: 1,
        name: 'ingest',
        status: 'completed',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects invalid SQLite job progress before persisting unreadable state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-sqlite-job-store-invalid-progress-'))

    try {
      const store = new BunSqliteJobStore(join(root, 'state.db'), 'demo')

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest'],
      })

      const percentError = await captureAsyncError(() => store.updateStageProgress('ingest', {percent: Number.NaN}))
      const missingError = await captureAsyncError(() => store.updateStageProgress('missing', {percent: 50}))

      expect(percentError?.message).to.include('percent must be a finite non-negative number')
      expect(missingError?.message).to.equal('Job stage not found: missing')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('clears stale completion metadata when a SQLite stage is rerun', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-sqlite-job-store-rerun-'))

    try {
      const store = new BunSqliteJobStore(join(root, 'state.db'), 'demo')

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest'],
      })
      await store.updateStage('ingest', 'running', undefined, 1)
      await store.updateStage('ingest', 'failed', 'previous failure', 1)
      await store.updateStage('ingest', 'running', undefined, 2)

      const state = await store.read()
      const stage = state.stages[0]

      expect(state.status).to.equal('running')
      expect(state.completedAt).to.equal(undefined)
      expect(stage).to.include({
        attempt: 2,
        name: 'ingest',
        status: 'running',
      })
      expect(stage?.completedAt).to.equal(undefined)
      expect(stage?.message).to.equal(undefined)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('marks SQLite jobs completed when all stages complete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-sqlite-job-store-auto-complete-'))

    try {
      const store = new BunSqliteJobStore(join(root, 'state.db'), 'demo')

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest', 'quality'],
      })
      await store.updateStage('ingest', 'completed', undefined, 1)
      await store.updateStage('quality', 'completed', undefined, 1)

      const state = await store.read()

      expect(state.status).to.equal('completed')
      expect(state.completedAt).to.be.a('string')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('marks SQLite jobs completed when remaining stages are skipped', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-sqlite-job-store-skip-'))

    try {
      const store = new BunSqliteJobStore(join(root, 'state.db'), 'demo')

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest', 'transcribe'],
      })
      await store.updateStage('ingest', 'completed', undefined, 1)
      await store.updateStage('transcribe', 'skipped', 'Text input', 1)

      const state = await store.read()

      expect(state.status).to.equal('completed')
      expect(state.stages.find((stage) => stage.name === 'transcribe')).to.deep.include({
        message: 'Text input',
        status: 'skipped',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function captureAsyncError(fn: () => Promise<unknown>): Promise<Error | undefined> {
  try {
    await fn()
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }

  return undefined
}
