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

  it('traces structured generation fallback output when fallback JSON is invalid', async () => {
    let calls = 0
    const traces: unknown[] = []
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
              text: '{"ok":"not boolean"}',
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
    const client = new AISDKLLMClient({
      model,
      trace: {
        record(trace) {
          traces.push(trace)
        },
      },
    })

    try {
      await client.generateObject({
        prompt: 'Return JSON',
        schema: z.object({
          ok: z.boolean(),
        }),
      })
      throw new Error('Expected generateObject to fail.')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
    }

    expect(traces).to.have.length(2)
    const structuredTrace = traces[0] as {error: {message: string}; model: string; operation: string; provider: string; request: {prompt?: string; schema?: unknown}; requestId: string; status: string; version: number}
    const fallbackTrace = traces[1] as {error: {message: string; name: string}; operation: string; response: {text: string}; status: string; usage: {totalTokens: number}}

    expect(structuredTrace.operation).to.equal('generateObject')
    expect(structuredTrace.status).to.equal('failed')
    expect(structuredTrace.error.message).to.equal('Bad Request')
    expect(structuredTrace.model).to.equal('mock-model')
    expect(structuredTrace.provider).to.equal('mock-provider')
    expect(structuredTrace.request.prompt).to.equal('Return JSON')
    expect(structuredTrace.request.schema).to.be.an('object')
    expect(structuredTrace.requestId).to.be.a('string')
    expect(structuredTrace.version).to.equal(1)
    expect(fallbackTrace.operation).to.equal('generateObjectFallbackText')
    expect(fallbackTrace.status).to.equal('failed')
    expect(fallbackTrace.error.name).to.equal('ZodError')
    expect(fallbackTrace.response.text).to.equal('{"ok":"not boolean"}')
    expect(fallbackTrace.usage.totalTokens).to.equal(7)
  })

  it('omits inline media payloads from traces', async () => {
    const traces: unknown[] = []
    const model = createMockLanguageModel({
      generateResult: {
        content: [
          {
            text: 'transcript',
            type: 'text',
          },
        ],
        finishReason: 'stop',
        usage: {
          inputTokens: 3,
          outputTokens: 1,
          totalTokens: 4,
        },
        warnings: [],
      },
    })
    const client = new AISDKLLMClient({
      model,
      trace: {
        record(trace) {
          traces.push(trace)
        },
      },
    })
    const data = 'data:audio/wav;base64,SGVsbG8='

    await client.generateText({
      messages: [
        {
          content: [
            {
              data,
              mediaType: 'audio/wav',
              type: 'file',
            },
          ],
          role: 'user',
        },
      ],
    })

    const trace = traces[0] as {request: {messages: Array<{content: Array<{data: string}>}>}}

    expect(trace.request.messages[0]?.content[0]?.data).to.contain('[omitted media payload:')
    expect(trace.request.messages[0]?.content[0]?.data).to.contain('mediaType=audio/wav')
    expect(trace.request.messages[0]?.content[0]?.data.includes('SGVsbG8=')).to.equal(false)
  })

  it('repairs a common malformed comparison object in fallback JSON', async () => {
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
                  text: [
                    '```json',
                    '{',
                    '  "comparison": {',
                    '    "left": {"label": "A", "points": ["a"]},',
                    '    {"label": "B", "points": ["b"]}',
                    '  }',
                    '}',
                    '```',
                  ].join('\n'),
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
        comparison: z.object({
          left: z.object({
            label: z.string(),
            points: z.array(z.string()),
          }),
          right: z.object({
            label: z.string(),
            points: z.array(z.string()),
          }),
        }),
      }),
    })

    expect(result.object).to.deep.equal({
      comparison: {
        left: {
          label: 'A',
          points: ['a'],
        },
        right: {
          label: 'B',
          points: ['b'],
        },
      },
    })
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
