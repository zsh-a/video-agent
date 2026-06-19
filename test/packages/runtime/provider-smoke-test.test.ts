import {expect} from '#test/expect'
import {writeBytes} from '#test/fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {GenerateObjectRequest, LLMClient} from '../../../packages/llm/src/index.js'

import {MIMO_PROVIDER_MODEL_IDS} from '../../../packages/providers/src/index.js'
import {writeConfig} from '../../../packages/runtime/src/shared/config.js'
import {runProviderSmokeTest} from '../../../packages/runtime/src/provider/smoke-test.js'

const asrOptionsKey = 'asr_options'
const completionTokensKey = 'completion_tokens'
const finishReasonKey = 'finish_reason'
const inputAudioKey = 'input_audio'
const promptTokensKey = 'prompt_tokens'
const totalTokensKey = 'total_tokens'

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

  it('runs llm providers through smoke tests with an injected LLM client', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-smoke-'))

    try {
      await writeConfig(root, {
        asr: 'llm',
        tts: 'llm',
        vlm: 'llm',
      })

      const report = await runProviderSmokeTest({
        llmClient: createSmokeTestLLMClient(),
        workspaceDir: root,
      })

      expect(report.ok).to.equal(true)
      expect(report.results.map((result) => `${result.role}:${result.provider}:${result.status}:${result.output?.type}`)).to.deep.equal([
        'asr:llm:succeeded:transcript',
        'vlm:llm:succeeded:scenes',
        'tts:llm:succeeded:tts',
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('runs Mimo profile ASR smoke tests through the AI SDK ASR client', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-smoke-mimo-'))
    const audioPath = join(root, 'source.wav')
    const originalFetch = Reflect.get(globalThis, 'fetch')
    const ResponseConstructor = Reflect.get(globalThis, 'Response') as new (body?: string, init?: {headers?: Record<string, string>}) => unknown
    let requestBody: unknown
    let requestUrl: string | undefined

    try {
      await writeConfig(root, {providerProfile: 'mimo'})
      await writeBytes(audioPath, Buffer.from([1, 2, 3]))

      Reflect.set(globalThis, 'fetch', async (input: unknown, init: undefined | {body?: unknown}) => {
        requestUrl = String(input)
        requestBody = JSON.parse(String(init?.body)) as unknown

        return new ResponseConstructor(JSON.stringify({
          choices: [
            {
              [finishReasonKey]: 'stop',
              message: {
                content: '这是中文转写。',
                role: 'assistant',
              },
            },
          ],
          id: 'chatcmpl-test',
          model: MIMO_PROVIDER_MODEL_IDS.asr,
          usage: {
            [completionTokensKey]: 4,
            [promptTokensKey]: 8,
            [totalTokensKey]: 12,
          },
        }), {
          headers: {
            'content-type': 'application/json',
          },
        })
      })

      const report = await runProviderSmokeTest({
        env: {
          VIDEO_AGENT_LLM_TOKEN: 'test-token',
        },
        mediaPath: audioPath,
        roles: ['asr'],
        workspaceDir: root,
      })
      const body = requestBody as {
        [asrOptionsKey]?: {language?: string}
        messages?: Array<{content?: Array<Record<string, string | {data?: string}>>}>
        model?: string
      }
      const audioPart = body.messages?.[0]?.content?.[0]?.[inputAudioKey]

      expect(report.ok).to.equal(true)
      expect(report.results[0]?.output).to.include({
        language: 'zh-CN',
        type: 'transcript',
      })
      expect(report.results[0]?.metadata).to.deep.equal({
        model: MIMO_PROVIDER_MODEL_IDS.asr,
      })
      expect(requestUrl).to.equal('https://token-plan-cn.xiaomimimo.com/v1/chat/completions')
      expect(body.model).to.equal(MIMO_PROVIDER_MODEL_IDS.asr)
      expect(body[asrOptionsKey]).to.deep.equal({language: 'auto'})
      expect(audioPart).to.deep.equal({
        data: 'data:audio/wav;base64,AQID',
      })
    } finally {
      Reflect.set(globalThis, 'fetch', originalFetch)
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

function createSmokeTestLLMClient(): LLMClient {
  return {
    async generateObject<T>(request: GenerateObjectRequest<T>) {
      const prompt = JSON.stringify(request.messages ?? request.prompt ?? '')
      let object: unknown

      if (prompt.includes('sceneBatches')) {
        object = [
          {
            description: 'LLM smoke test scene.',
            evidence: ['provider-smoke-test-frame.jpg'],
            sceneId: 'provider-smoke-test-scene',
          },
        ]
      } else if (prompt.includes('llm-tts')) {
        object = [
          {
            duration: 1,
            narrationId: 'provider-smoke-test',
            path: 'llm-tts/provider-smoke-test.wav',
          },
        ]
      } else {
        object = {
          language: 'en',
          segments: [
            {
              end: 1,
              start: 0,
              text: 'LLM smoke test transcript.',
            },
          ],
          text: 'LLM smoke test transcript.',
        }
      }

      return {object: object as T}
    },
    async generateText() {
      throw new Error('Not used by this test.')
    },
    streamText() {
      throw new Error('Not used by this test.')
    },
  }
}
