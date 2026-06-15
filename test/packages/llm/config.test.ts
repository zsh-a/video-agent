import {expect} from '#test/expect'

import {createLanguageModelFromConfig, createLLMClientFromConfig} from '../../../packages/llm/src/index.js'

const asrOptionsKey = 'asr_options'
const completionTokensKey = 'completion_tokens'
const finishReasonKey = 'finish_reason'
const inputAudioKey = 'input_audio'
const promptTokensKey = 'prompt_tokens'
const totalTokensKey = 'total_tokens'

describe('LLM config factory', () => {
  it('creates an AI SDK Anthropic-compatible model from config', () => {
    const model = createLanguageModelFromConfig({
      authTokenEnv: 'VIDEO_AGENT_LLM_TOKEN',
      baseURL: 'https://llm.example.test/anthropic',
      model: 'mimo-v2.5-pro',
      name: 'mimo',
      provider: 'anthropic',
    }, {
      env: {
        VIDEO_AGENT_LLM_TOKEN: 'test-token',
      },
    })

    const modelMetadata = model as {modelId: string; provider: string; specificationVersion: string}

    expect(modelMetadata.provider).to.equal('mimo')
    expect(modelMetadata.modelId).to.equal('mimo-v2.5-pro')
    expect(modelMetadata.specificationVersion).to.equal('v3')
  })

  it('returns no client when LLM config is not set', () => {
    expect(createLLMClientFromConfig()).to.equal(undefined)
  })

  it('adapts Mimo ASR requests through the AI SDK OpenAI-compatible provider', async () => {
    const originalFetch = Reflect.get(globalThis, 'fetch')
    const ResponseConstructor = Reflect.get(globalThis, 'Response') as new (body?: string, init?: {headers?: Record<string, string>}) => unknown
    let requestBody: unknown

    try {
      Reflect.set(globalThis, 'fetch', async (_input: unknown, init: undefined | {body?: unknown}) => {
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
          model: 'mimo-v2.5-asr',
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

      const client = createLLMClientFromConfig({
        apiKeyEnv: 'VIDEO_AGENT_LLM_TOKEN',
        baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
        model: 'mimo-v2.5-asr',
        name: 'mimo',
        provider: 'openai-compatible',
      }, {
        env: {
          VIDEO_AGENT_LLM_TOKEN: 'test-token',
        },
      })

      const result = await client?.generateText({
        messages: [
          {
            content: [
              {
                data: new Uint8Array([1, 2, 3]),
                mediaType: 'audio/wav',
                type: 'file',
              },
            ],
            role: 'user',
          },
        ],
        providerOptions: {
          mimo: {
            [asrOptionsKey]: {
              language: 'auto',
            },
          },
        },
      })
      const body = requestBody as {
        [asrOptionsKey]?: {language?: string}
        messages?: Array<{content?: Array<Record<string, string | {data?: string; format?: string}>>}>
        model?: string
      }
      const content = body.messages?.[0]?.content
      const audioPart = content?.[0]?.[inputAudioKey]

      expect(result?.text).to.equal('这是中文转写。')
      expect(body.model).to.equal('mimo-v2.5-asr')
      expect(body[asrOptionsKey]).to.deep.equal({language: 'auto'})
      expect(audioPart).to.deep.equal({
        data: 'data:audio/wav;base64,AQID',
      })
    } finally {
      Reflect.set(globalThis, 'fetch', originalFetch)
    }
  })
})
