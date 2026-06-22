import {expect} from '#test/expect'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createConfiguredJobStore} from '../../../packages/runtime/src/shared/job-store.js'

describe('runtime job store', () => {
  it('uses the JSON job store by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-runtime-job-store-'))
    const projectDir = join(root, 'projects', 'demo')

    try {
      const store = createConfiguredJobStore({
        config: {
          persistence: {
            jobStore: 'json',
          },
          pipeline: {
            maxStageRetries: 0,
            retryBackoffMs: 0,
          },
          providers: {
            asr: 'mock',
            tts: 'mock',
            vlm: 'mock',
          },
          providerSettings: {},
          version: 1,
        },
        projectDir,
        projectId: 'demo',
        workspaceDir: root,
      })

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest'],
      })

      expect((await store.read()).projectId).to.equal('demo')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('uses the Bun SQLite job store when configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-runtime-job-store-'))

    try {
      const store = createConfiguredJobStore({
        config: {
          persistence: {
            jobStore: 'sqlite',
          },
          pipeline: {
            maxStageRetries: 0,
            retryBackoffMs: 0,
          },
          providers: {
            asr: 'mock',
            tts: 'mock',
            vlm: 'mock',
          },
          providerSettings: {},
          version: 1,
        },
        projectDir: join(root, 'projects', 'demo'),
        projectId: 'demo',
        workspaceDir: root,
      })

      await store.initialize({
        inputPath: '/tmp/input.mp4',
        pipeline: 'film',
        projectId: 'demo',
        stages: ['ingest'],
      })

      expect((await store.read()).projectId).to.equal('demo')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
