import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ProviderFetch} from '../../../packages/providers/src/index.js'

import {createMockHttpProviderEnvelope} from '../../../examples/provider-adapters/mock-http-provider.js'
import {writeConfig} from '../../../packages/runtime/src/config.js'
import {runProviderSmokeTest} from '../../../packages/runtime/src/provider-smoke-test.js'

describe('provider smoke test', () => {
  it('runs all mock providers by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-smoke-'))

    try {
      const report = await runProviderSmokeTest({workspaceDir: root})

      expect(report.ok).to.equal(true)
      expect(report.summary).to.deep.equal({
        failed: 0,
        failedRoles: [],
        succeeded: 3,
        total: 3,
      })
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

  it('runs the documented HTTP adapter recipe through smoke tests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-smoke-'))

    try {
      await writeConfig(root, {
        asr: 'http',
        tts: 'http',
        vlm: 'http',
      })

      const report = await runProviderSmokeTest({
        env: {
          VIDEO_AGENT_ASR_TIMEOUT_MS: '5000',
          VIDEO_AGENT_ASR_URL: 'http://127.0.0.1:4318',
          VIDEO_AGENT_TTS_TIMEOUT_MS: '5000',
          VIDEO_AGENT_TTS_URL: 'http://127.0.0.1:4318',
          VIDEO_AGENT_VLM_TIMEOUT_MS: '5000',
          VIDEO_AGENT_VLM_URL: 'http://127.0.0.1:4318',
        },
        fetch: mockHttpRecipeFetch(),
        workspaceDir: root,
      })

      expect(report.ok).to.equal(true)
      expect(report.results.map((result) => `${result.role}:${result.provider}:${result.status}:${result.metadata?.model}:${result.output?.type}`)).to.deep.equal([
        'asr:http:succeeded:example-http-provider:transcript',
        'vlm:http:succeeded:example-http-provider:scenes',
        'tts:http:succeeded:example-http-provider:tts',
      ])
      expect(report.results.every((result) => result.metadata?.requestId?.startsWith('http_') === true)).to.equal(true)
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
      expect(report.summary).to.deep.equal({
        failed: 1,
        failedRoles: ['asr'],
        succeeded: 0,
        total: 1,
      })
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

  it('reports provider response validation issues without throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-smoke-'))

    try {
      await writeConfig(root, {asr: 'command'})

      const report = await runProviderSmokeTest({
        env: {
          VIDEO_AGENT_ASR_COMMAND: JSON.stringify(['sh', '-c', String.raw`cat >/dev/null; printf "%s\n" "$1"`, 'provider-json', '{"text":"bad","segments":[{"start":2,"end":1,"text":"bad"}]}']),
        },
        roles: ['asr'],
        workspaceDir: root,
      })

      expect(report.ok).to.equal(false)
      expect(report.results[0]).to.include({
        provider: 'command',
        role: 'asr',
        status: 'failed',
      })
      expect(report.results[0]?.error).to.include({
        name: 'ProviderResponseValidationError',
      })
      expect(report.results[0]?.error?.validationIssues?.map((issue) => issue.path.join('.'))).to.include('segments.0.end')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

function mockHttpRecipeFetch(): ProviderFetch {
  return async (_url, init) => {
    const result = createMockHttpProviderEnvelope(JSON.parse(init.body) as Record<string, unknown>, init.headers)

    return {
      async json() {
        return result
      },
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(result)
      },
    }
  }
}
