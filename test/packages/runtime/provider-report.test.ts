import {expect} from '#test/expect'
import {writeText} from '#test/fs'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {readProjectProviderReport} from '../../../packages/runtime/src/provider-report.js'

describe('project provider report', () => {
  it('summarizes provider usage, cost, latency, and filtered calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-report-'))

    try {
      await mkdir(join(root, 'projects', 'demo', 'artifacts'), {recursive: true})
      await writeText(
        join(root, 'projects', 'demo', 'artifacts', 'provider-calls.jsonl'),
        [
          JSON.stringify({
            completedAt: '2026-01-01T00:00:01.000Z',
            cost: {amount: 0.01, currency: 'USD'},
            durationMs: 100,
            input: {},
            model: 'asr-model',
            operation: 'transcribe',
            output: {},
            provider: 'llm',
            requestId: 'asr-1',
            role: 'asr',
            startedAt: '2026-01-01T00:00:00.900Z',
            status: 'succeeded',
            usage: {audioSeconds: 12.3456789, inputTokens: 10, outputTokens: 5},
            version: 1,
          }),
          JSON.stringify({
            completedAt: '2026-01-01T00:00:02.000Z',
            cost: {amount: 0.02, currency: 'USD'},
            durationMs: 200,
            error: {message: 'bad frame', name: 'Error'},
            input: {},
            model: 'vlm-model',
            operation: 'analyzeScenes',
            provider: 'llm',
            requestId: 'vlm-1',
            role: 'vlm',
            startedAt: '2026-01-01T00:00:01.800Z',
            status: 'failed',
            usage: {inputCharacters: 100, outputCharacters: 50},
            version: 1,
          }),
        ].join('\n'),
      )

      const report = await readProjectProviderReport('demo', {workspaceDir: root})
      const failedVlm = await readProjectProviderReport('demo', {role: 'vlm', status: 'failed', workspaceDir: root})

      expect(report.summary.total).to.equal(2)
      expect(report.summary.failed).to.equal(1)
      expect(report.summary.costs).to.deep.equal({USD: 0.03})
      expect(report.summary.durationMs).to.deep.equal({average: 150, max: 200, total: 300})
      expect(report.summary.usage).to.deep.equal({
        audioSeconds: 12.345679,
        inputCharacters: 100,
        inputTokens: 10,
        outputCharacters: 50,
        outputTokens: 5,
        totalTokens: 15,
      })
      expect(report.summary.byRole.asr.succeeded).to.equal(1)
      expect(report.summary.byRole.vlm.failed).to.equal(1)
      expect(report.summary.byProvider.llm.total).to.equal(2)
      expect(report.summary.byModel['vlm-model']?.failed).to.equal(1)
      expect(failedVlm.calls).to.have.length(1)
      expect(failedVlm.summary.byRole.vlm.failed).to.equal(1)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
