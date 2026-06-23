import {expect} from '#test/expect'
import {z} from 'zod'

import {createLanguageModelFromConfig, createLLMClientFromConfig, createMimoApiKeyEnvCandidates} from '../../../packages/llm/src/index.js'

const asrOptionsKey = 'asr_options'
const completionTokensKey = 'completion_tokens'
const finishReasonKey = 'finish_reason'
const inputAudioKey = 'input_audio'
const mimoAsrTestModel = 'mimo-asr-test-model'
const promptTokensKey = 'prompt_tokens'
const totalTokensKey = 'total_tokens'

describe('LLM config factory', () => {
  it('creates an AI SDK Anthropic-compatible model from config', () => {
    const model = createLanguageModelFromConfig({
      apiKeyEnv: 'VIDEO_AGENT_LLM_TOKEN',
      baseURL: 'https://llm.example.test/anthropic',
      model: 'anthropic-test-model',
      name: 'anthropic-test',
      provider: 'anthropic',
    }, {
      env: {
        VIDEO_AGENT_LLM_TOKEN: 'test-token',
      },
    })

    const modelMetadata = model as {modelId: string; provider: string; specificationVersion: string}

    expect(modelMetadata.provider).to.equal('anthropic-test')
    expect(modelMetadata.modelId).to.equal('anthropic-test-model')
    expect(modelMetadata.specificationVersion).to.equal('v3')
  })

  it('returns no client when LLM config is not set', () => {
    expect(createLLMClientFromConfig()).to.equal(undefined)
  })

  it('creates normalized Mimo API key environment candidates', () => {
    expect(createMimoApiKeyEnvCandidates({apiKeyEnv: ' VIDEO_AGENT_LLM_TOKEN '})).to.deep.equal([
      'VIDEO_AGENT_LLM_TOKEN',
      'MIMO_API_KEY',
    ])
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
          model: mimoAsrTestModel,
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
        model: mimoAsrTestModel,
        name: 'mimo',
        provider: 'openai-compatible',
      }, {
        env: {
          MIMO_API_KEY: 'test-token',
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
      expect(body.model).to.equal(mimoAsrTestModel)
      expect(body[asrOptionsKey]).to.deep.equal({language: 'auto'})
      expect(audioPart).to.deep.equal({
        data: 'data:audio/wav;base64,AQID',
      })
    } finally {
      Reflect.set(globalThis, 'fetch', originalFetch)
    }
  })

  it('sends Mimo object requests with OpenAI-compatible JSON schema response format', async () => {
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
                content: '{"language":"zh-CN","sourceRange":[0,1]}',
                role: 'assistant',
              },
            },
          ],
          id: 'chatcmpl-test',
          model: 'mimo-v2.5',
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
        model: 'mimo-v2.5',
        name: 'mimo',
        provider: 'openai-compatible',
      }, {
        env: {
          MIMO_API_KEY: 'test-token',
        },
      })

      const result = await client?.generateObject({
        prompt: 'Return JSON.',
        schema: z.object({
          language: z.string(),
          sourceRange: z.tuple([
            z.number().nonnegative(),
            z.number().nonnegative(),
          ]),
        }),
      })
      const body = requestBody as {
        response_format?: {
          json_schema?: {
            schema?: {
              $schema?: unknown
              properties?: {
                sourceRange?: {
                  items?: unknown
                  maxItems?: number
                  minItems?: number
                  prefixItems?: unknown
                }
              }
              required?: string[]
            }
            strict?: boolean
          }
          type?: string
        }
      }

      const sourceRangeSchema = body.response_format?.json_schema?.schema?.properties?.sourceRange

      expect(result?.object).to.deep.equal({language: 'zh-CN', sourceRange: [0, 1]})
      expect(body.response_format?.type).to.equal('json_schema')
      expect(body.response_format?.json_schema?.strict).to.equal(true)
      expect(body.response_format?.json_schema?.schema?.$schema).to.equal(undefined)
      expect(body.response_format?.json_schema?.schema?.required).to.deep.equal(['language', 'sourceRange'])
      expect(sourceRangeSchema?.items).to.deep.equal({minimum: 0, type: 'number'})
      expect(sourceRangeSchema?.prefixItems).to.equal(undefined)
      expect(sourceRangeSchema?.minItems).to.equal(2)
      expect(sourceRangeSchema?.maxItems).to.equal(2)
    } finally {
      Reflect.set(globalThis, 'fetch', originalFetch)
    }
  })
})
