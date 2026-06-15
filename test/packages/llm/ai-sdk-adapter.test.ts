import {expect} from '#test/expect'
import {APICallError, type LanguageModel, simulateReadableStream} from 'ai'
import {z} from 'zod'

import {AISDKLLMClient} from '../../../packages/llm/src/index.js'

describe('AI SDK LLM adapter', () => {
  it('generates text through the internal LLM client interface', async () => {
    const model = createMockLanguageModel({
      generateResult: {
        content: [
          {
            text: 'hello from ai sdk',
            type: 'text',
          },
        ],
        finishReason: 'stop',
        usage: {
          inputTokens: 3,
          outputTokens: 4,
          totalTokens: 7,
        },
        warnings: [],
      },
    })
    const client = new AISDKLLMClient({model})

    const result = await client.generateText({prompt: 'Say hello'})

    expect(result).to.deep.equal({
      text: 'hello from ai sdk',
      usage: {
        inputTokens: 3,
        outputTokens: 4,
        totalTokens: 7,
      },
    })
  })

  it('generates structured objects with Zod schemas', async () => {
    const model = createMockLanguageModel({
      generateResult: {
        content: [
          {
            text: '{"scenes":[{"start":0,"duration":1,"narration":"hello"}]}',
            type: 'text',
          },
        ],
        finishReason: 'stop',
        usage: {
          inputTokens: 5,
          outputTokens: 8,
          totalTokens: 13,
        },
        warnings: [],
      },
    })
    const client = new AISDKLLMClient({model})
    const schema = z.object({
      scenes: z.array(z.object({
        duration: z.number(),
        narration: z.string(),
        start: z.number(),
      })),
    })

    const result = await client.generateObject({
      prompt: 'Create a storyboard',
      schema,
    })

    expect(result.object).to.deep.equal({
      scenes: [
        {
          duration: 1,
          narration: 'hello',
          start: 0,
        },
      ],
    })
    expect(result.usage?.totalTokens).to.equal(13)
  })

  it('falls back to text JSON when structured object generation returns no object', async () => {
    let calls = 0
    const model = createMockLanguageModel({
      async generateResult() {
        calls += 1

        return calls === 1
          ? {
              content: [],
              finishReason: 'stop',
              usage: {
                inputTokens: 1,
                outputTokens: 0,
                totalTokens: 1,
              },
              warnings: [],
            }
          : {
              content: [
                {
                  text: '```json\n{"ok":true}\n```',
                  type: 'text',
                },
              ],
              finishReason: 'stop',
              usage: {
                inputTokens: 4,
                outputTokens: 3,
                totalTokens: 7,
              },
              warnings: [],
            }
      },
    })
    const client = new AISDKLLMClient({model})

    const result = await client.generateObject({
      prompt: 'Return JSON',
      schema: z.object({
        ok: z.boolean(),
      }),
    })

    expect(result.object).to.deep.equal({ok: true})
    expect(result.usage?.totalTokens).to.equal(7)
  })

  it('falls back to text JSON when structured object generation receives a bad request', async () => {
    let calls = 0
    const model = createMockLanguageModel({
      async generateResult() {
        calls += 1

        if (calls === 1) {
          throw new APICallError({
            isRetryable: false,
            message: 'Bad Request',
            requestBodyValues: {},
            statusCode: 400,
            url: 'https://example.test/messages',
          })
        }

        return {
          content: [
            {
              text: '{"ok":true}',
              type: 'text',
            },
          ],
          finishReason: 'stop',
          usage: {
            inputTokens: 4,
            outputTokens: 3,
            totalTokens: 7,
          },
          warnings: [],
        }
      },
    })
    const client = new AISDKLLMClient({model})

    const result = await client.generateObject({
      prompt: 'Return JSON',
      schema: z.object({
        ok: z.boolean(),
      }),
    })

    expect(result.object).to.deep.equal({ok: true})
  })

  it('streams text events while preserving final usage', async () => {
    const model = createMockLanguageModel({
      streamResult: {
        stream: simulateReadableStream({
          chunks: [
            {
              id: 'text-1',
              type: 'text-start',
            },
            {
              delta: 'hel',
              id: 'text-1',
              type: 'text-delta',
            },
            {
              delta: 'lo',
              id: 'text-1',
              type: 'text-delta',
            },
            {
              id: 'text-1',
              type: 'text-end',
            },
            {
              finishReason: 'stop',
              type: 'finish',
              usage: {
                inputTokens: 2,
                outputTokens: 2,
                totalTokens: 4,
              },
            },
          ],
        }),
      },
    })
    const client = new AISDKLLMClient({model})
    const events = []

    for await (const event of client.streamText({messages: [{content: 'Say hello', role: 'user'}]})) {
      events.push(event)
    }

    expect(events).to.deep.equal([
      {
        text: 'hel',
        type: 'text-delta',
      },
      {
        text: 'lo',
        type: 'text-delta',
      },
      {
        text: 'hello',
        type: 'text',
        usage: {
          inputTokens: 2,
          outputTokens: 2,
          totalTokens: 4,
        },
      },
    ])
  })
})

function createMockLanguageModel(options: {
  generateResult?: (() => unknown) | unknown
  streamResult?: unknown
}): LanguageModel {
  return {
    doGenerate: async () => typeof options.generateResult === 'function' ? options.generateResult() : options.generateResult,
    doStream: async () => options.streamResult,
    modelId: 'mock-model',
    provider: 'mock-provider',
    specificationVersion: 'v2',
    supportedUrls: {},
  } as LanguageModel
}
