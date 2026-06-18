import {expect} from '#test/expect'
import {mkdtemp, rm} from 'node:fs/promises'
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
        projectId: 'demo',
        stages: ['ingest', 'quality'],
      })
      await store.updateStage('ingest', 'running', undefined, 1)
      await store.updateStage('ingest', 'completed', undefined, 1)
      await store.complete('completed')

      const state = await store.read()

      expect(state.status).to.equal('completed')
      expect(state.stages[0]).to.include({
        attempt: 1,
        name: 'ingest',
        status: 'completed',
      })
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

  it('persists job stage state in SQLite when running on Bun', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-sqlite-job-store-'))

    try {
      const store = new BunSqliteJobStore(join(root, 'state.db'), 'demo')

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: ['ingest', 'quality'],
      })
      await store.updateStage('ingest', 'running', undefined, 1)
      await store.updateStage('ingest', 'completed', undefined, 1)
      await store.complete('completed')

      const state = await store.read()

      expect(state.status).to.equal('completed')
      expect(state.stages[0]).to.include({
        attempt: 1,
        name: 'ingest',
        status: 'completed',
      })
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
})
