import {expect} from '#test/expect'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {readProjectEvents} from '../../../packages/runtime/src/project-events.js'

describe('project events', () => {
  it('reads sorted pipeline events and provider calls with filters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-events-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await mkdir(artifactsDir, {recursive: true})
      await writeFile(
        join(artifactsDir, 'pipeline-events.jsonl'),
        [
          JSON.stringify({projectId: 'demo', stage: 'ingest', time: '2026-01-01T00:00:00.000Z', type: 'stage:start'}),
          JSON.stringify({projectId: 'demo', stage: 'quality', time: '2026-01-01T00:00:03.000Z', type: 'stage:complete'}),
        ].join('\n'),
      )
      await writeFile(
        join(artifactsDir, 'provider-calls.jsonl'),
        [
          JSON.stringify({completedAt: '2026-01-01T00:00:01.000Z', durationMs: 100, input: {}, operation: 'transcribe', output: {}, provider: 'mock', role: 'asr', startedAt: '2026-01-01T00:00:00.900Z', status: 'succeeded', version: 1}),
          JSON.stringify({completedAt: '2026-01-01T00:00:02.000Z', durationMs: 100, error: {message: 'failed', name: 'Error'}, input: {}, operation: 'analyzeScenes', provider: 'mock', role: 'vlm', startedAt: '2026-01-01T00:00:01.900Z', status: 'failed', version: 1}),
        ].join('\n'),
      )

      const all = await readProjectEvents('demo', {workspaceDir: root})
      const failedProviders = await readProjectEvents('demo', {
        kind: 'provider',
        providerStatus: 'failed',
        workspaceDir: root,
      })
      const ingestStarts = await readProjectEvents('demo', {
        kind: 'pipeline',
        pipelineStage: 'ingest',
        pipelineType: 'stage:start',
        workspaceDir: root,
      })
      const limited = await readProjectEvents('demo', {
        limit: 2,
        workspaceDir: root,
      })

      expect(all.events.map((event) => event.kind)).to.deep.equal(['pipeline', 'provider', 'provider', 'pipeline'])
      expect(failedProviders.events).to.have.length(1)
      expect(failedProviders.events[0].kind).to.equal('provider')
      expect(ingestStarts.events).to.have.length(1)
      expect(ingestStarts.events[0]).to.deep.include({
        kind: 'pipeline',
        time: '2026-01-01T00:00:00.000Z',
      })
      expect(limited.events.map((event) => event.time)).to.deep.equal(['2026-01-01T00:00:02.000Z', '2026-01-01T00:00:03.000Z'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns an empty list when logs are absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-events-'))

    try {
      const result = await readProjectEvents('missing-logs', {workspaceDir: root})

      expect(result.events).to.deep.equal([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
