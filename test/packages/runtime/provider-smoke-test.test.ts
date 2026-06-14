import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeConfig} from '../../../packages/runtime/src/config.js'
import {runProviderSmokeTest} from '../../../packages/runtime/src/provider-smoke-test.js'

describe('provider smoke test', () => {
  it('runs all mock providers by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-smoke-'))

    try {
      const report = await runProviderSmokeTest({workspaceDir: root})

      expect(report.ok).to.equal(true)
      expect(report.results.map((result) => result.role)).to.deep.equal(['asr', 'vlm', 'tts'])
      expect(report.results.map((result) => result.status)).to.deep.equal(['succeeded', 'succeeded', 'succeeded'])
      expect(report.results.map((result) => result.output?.type)).to.deep.equal(['transcript', 'scenes', 'tts'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('runs the documented command adapter recipe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-smoke-'))
    const command = '["bun","examples/provider-adapters/mock-json-provider.ts"]'

    try {
      await writeConfig(root, {
        asr: 'command',
        tts: 'command',
        vlm: 'command',
      })

      const report = await runProviderSmokeTest({
        env: {
          VIDEO_AGENT_ASR_COMMAND: command,
          VIDEO_AGENT_TTS_COMMAND: command,
          VIDEO_AGENT_VLM_COMMAND: command,
        },
        workspaceDir: root,
      })

      expect(report.ok).to.equal(true)
      expect(report.results.map((result) => result.metadata?.model)).to.deep.equal([
        'example-command-provider',
        'example-command-provider',
        'example-command-provider',
      ])
      expect(report.results.find((result) => result.role === 'asr')?.output).to.include({
        type: 'transcript',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports provider setup failures without throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-smoke-'))

    try {
      await writeConfig(root, {asr: 'command'})

      const report = await runProviderSmokeTest({
        env: {},
        roles: ['asr'],
        workspaceDir: root,
      })

      expect(report.ok).to.equal(false)
      expect(report.results).to.have.length(1)
      expect(report.results[0]).to.include({
        provider: 'command',
        role: 'asr',
        status: 'failed',
      })
      expect(report.results[0]?.error?.message).to.contain('VIDEO_AGENT_ASR_COMMAND')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
