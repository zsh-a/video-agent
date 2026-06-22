import {expect} from '#test/expect'
import {APICallError, simulateReadableStream} from 'ai'
import {MockLanguageModelV3} from 'ai/test'
import {z} from 'zod'

import {AISDKLLMClient, createObjectPromptRequest} from '../../../packages/llm/src/index.js'

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
        usage: testUsage(3, 4),
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
        usage: testUsage(5, 8),
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

  it('traces prompt metadata for PromptSpec requests', async () => {
    const traces: unknown[] = []
    const schema = z.object({
      ok: z.boolean(),
    })
    const model = createMockLanguageModel({
      generateResult: {
        content: [
          {
            text: '{"ok":true}',
            type: 'text',
          },
        ],
        finishReason: 'stop',
        usage: testUsage(5, 3),
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
    const request = createObjectPromptRequest({
      buildMessages: (input: {topic: string}) => [{
        content: JSON.stringify({
          goal: 'Return test JSON.',
          topic: input.topic,
        }),
        role: 'user',
      }],
      id: 'test.prompt',
      schema,
      schemaName: 'TestPromptOutput',
      stage: 'unit-test',
      temperature: 0.1,
      version: 'v1',
    }, {
      topic: 'metadata',
    })

    const result = await client.generateObject(request)

    expect(result.object).to.deep.equal({ok: true})
    expect(request.promptMetadata).to.deep.include({
      id: 'test.prompt',
      schemaName: 'TestPromptOutput',
      stage: 'unit-test',
      version: 'v1',
    })
    expect(request.promptMetadata?.inputHash).to.match(/^[a-f0-9]{64}$/u)
    const trace = traces[0] as {prompt?: unknown; request?: {promptMetadata?: unknown}}
    expect(trace.prompt).to.deep.equal(request.promptMetadata)
    expect(trace.request?.promptMetadata).to.deep.equal(request.promptMetadata)
  })

  it('applies cache hints to message provider options', async () => {
    let generateInput: {prompt?: Array<{providerOptions?: Record<string, Record<string, unknown>>}>} | undefined
    const model = createMockLanguageModel({
      generateResult(input) {
        generateInput = input as typeof generateInput

        return {
          content: [
            {
              text: 'cached result',
              type: 'text',
            },
          ],
          finishReason: 'stop',
          usage: testUsage(21, 2),
          warnings: [],
        }
      },
    })
    const client = new AISDKLLMClient({model})

    const result = await client.generateText({
      cache: {
        key: 'deck:slide-plan:test',
        messageIndex: 0,
        mode: 'ephemeral',
      },
      messages: [
        {
          content: 'Stable deck planning context',
          role: 'user',
        },
        {
          content: 'Dynamic rewrite feedback',
          role: 'user',
        },
      ],
    })

    expect(generateInput?.prompt?.[0]?.providerOptions?.anthropic).to.deep.equal({
      cacheControl: {type: 'ephemeral'},
    })
    expect(generateInput?.prompt?.[1]?.providerOptions).to.equal(undefined)
    expect(result.usage?.totalTokens).to.equal(23)
  })

  it('rejects structured object generation that returns no object', async () => {
    let calls = 0
    const model = createMockLanguageModel({
      async generateResult() {
        calls += 1

        return {
          content: [],
          finishReason: 'stop',
          usage: testUsage(1, 0),
          warnings: [],
        }
      },
    })
    const client = new AISDKLLMClient({model})

    try {
      await client.generateObject({
        prompt: 'Return JSON',
        schema: z.object({
          ok: z.boolean(),
        }),
      })
      expect.fail('Expected missing structured object to fail.')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
    }
    expect(calls).to.equal(1)
  })

  it('propagates structured object bad requests without JSON text fallback', async () => {
    let calls = 0
    const traces: unknown[] = []
    const model = createMockLanguageModel({
      async generateResult() {
        calls += 1

        throw new APICallError({
          isRetryable: false,
          message: 'Bad Request',
          requestBodyValues: {response_format: {type: 'json_schema'}},
          responseBody: '{"error":"unsupported response_format"}',
          statusCode: 400,
          url: 'https://example.test/messages',
        })
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
      expect.fail('Expected bad request to fail.')
    } catch (error) {
      expect(error).to.be.instanceOf(APICallError)
    }

    expect(calls).to.equal(1)
    expect(traces).to.have.length(1)
    const structuredTrace = traces[0] as {error: {details?: {requestBodyValues?: unknown; responseBody?: unknown; statusCode?: number; url?: string}; message: string}; model: string; operation: string; provider: string; request: {prompt?: string; schema?: unknown}; requestId: string; status: string; version: number}

    expect(structuredTrace.operation).to.equal('generateObject')
    expect(structuredTrace.status).to.equal('failed')
    expect(structuredTrace.error.message).to.equal('Bad Request')
    expect(structuredTrace.error.details?.statusCode).to.equal(400)
    expect(structuredTrace.error.details?.url).to.equal('https://example.test/messages')
    expect(structuredTrace.error.details?.requestBodyValues).to.deep.equal({response_format: {type: 'json_schema'}})
    expect(structuredTrace.model).to.equal('mock-model')
    expect(structuredTrace.provider).to.equal('mock-provider')
    expect(structuredTrace.request.prompt).to.equal('Return JSON')
    expect(structuredTrace.request.schema).to.be.an('object')
    expect(structuredTrace.requestId).to.be.a('string')
    expect(structuredTrace.version).to.equal(1)
  })

  it('lifts retryable API errors into traces', async () => {
    const traces: unknown[] = []
    const model = createMockLanguageModel({
      async generateResult() {
        const error = new Error('Rate limited') as Error & {isRetryable: boolean; statusCode: number; url: string}

        error.isRetryable = true
        error.statusCode = 429
        error.url = 'https://example.test/messages'

        throw error
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
      await client.generateText({prompt: 'Say hello'})
      expect.fail('Expected generateText to fail.')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
    }

    expect((traces[0] as {error: {retryable?: boolean}}).error.retryable).to.equal(true)
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
        usage: testUsage(3, 1),
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
              usage: testUsage(2, 2),
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
  generateResult?: ((input: unknown) => unknown) | unknown
  streamResult?: unknown
}): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: 'mock-model',
    provider: 'mock-provider',
    supportedUrls: {},
    doGenerate: async (input: unknown) => typeof options.generateResult === 'function' ? options.generateResult(input) : options.generateResult,
    doStream: async () => options.streamResult,
  })
}

function testUsage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: {
      cacheRead: undefined,
      cacheWrite: undefined,
      noCache: inputTokens,
      total: inputTokens,
    },
    outputTokens: {
      reasoning: undefined,
      text: outputTokens,
      total: outputTokens,
    },
  }
}
