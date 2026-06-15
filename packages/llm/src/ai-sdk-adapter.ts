import type {LanguageModel, ModelMessage} from 'ai'

import {APICallError, generateObject, generateText, NoObjectGeneratedError, RetryError, streamText} from 'ai'
import {toJSONSchema} from 'zod'

import type {
  GenerateObjectRequest,
  GenerateObjectResult,
  GenerateTextRequest,
  GenerateTextResult,
  LLMClient,
  LLMEvent,
  LLMUsage,
  StreamTextRequest,
} from './types.js'

export interface AISDKLLMClientOptions {
  model: LanguageModel
}

export class AISDKLLMClient implements LLMClient {
  constructor(private readonly options: AISDKLLMClientOptions) {}

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>> {
    try {
      const result = await generateObject({
        ...createPromptInput(request),
        model: this.options.model,
        ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
        schema: request.schema,
        ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
      })

      return {
        object: result.object,
        usage: normalizeUsage(result.usage),
      }
    } catch (error) {
      if (!shouldFallbackToJsonText(error)) {
        throw error
      }

      return this.generateObjectFromJsonText(request, error)
    }
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const result = await generateText({
      ...createPromptInput(request),
      model: this.options.model,
      ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
      ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
    })

    return {
      text: result.text,
      usage: normalizeUsage(result.usage),
    }
  }

  async *streamText(request: StreamTextRequest): AsyncIterable<LLMEvent> {
    const result = streamText({
      ...createPromptInput(request),
      model: this.options.model,
      ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
      ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
    })

    for await (const text of result.textStream) {
      yield {
        text,
        type: 'text-delta',
      }
    }

    yield {
      text: await result.text,
      type: 'text',
      usage: normalizeUsage(await result.usage),
    }
  }

  private async generateObjectFromJsonText<T>(request: GenerateObjectRequest<T>, originalError: unknown): Promise<GenerateObjectResult<T>> {
    const result = await generateText({
      ...createJsonFallbackPromptInput(request),
      model: this.options.model,
      ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
      ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
    })

    try {
      return {
        object: request.schema.parse(parseJsonFromText(result.text)),
        usage: normalizeUsage(result.usage),
      }
    } catch (error) {
      throw new Error(`LLM JSON fallback failed after structured object generation failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: originalError,
      })
    }
  }
}

function createPromptInput(request: GenerateTextRequest): {messages: ModelMessage[]} | {prompt: string} {
  if (request.messages !== undefined) {
    return {
      messages: request.messages,
    }
  }

  if (request.prompt !== undefined) {
    return {
      prompt: request.prompt,
    }
  }

  throw new Error('LLM request requires either prompt or messages.')
}

function shouldFallbackToJsonText(error: unknown): boolean {
  return NoObjectGeneratedError.isInstance(error)
    || isBadRequestApiError(error)
    || (RetryError.isInstance(error) && isBadRequestApiError(error.lastError))
}

function isBadRequestApiError(error: unknown): boolean {
  return APICallError.isInstance(error) && error.statusCode === 400
}

function createJsonFallbackPromptInput<T>(request: GenerateObjectRequest<T>): {messages: ModelMessage[]} | {prompt: string} {
  const instruction = [
    'Return only valid JSON. Do not include markdown fences, prose, or commentary.',
    'The JSON must conform to this JSON Schema:',
    JSON.stringify(toJSONSchema(request.schema), null, 2),
  ].join('\n')

  if (request.messages !== undefined) {
    return {
      messages: [
        ...request.messages,
        {
          content: instruction,
          role: 'user',
        },
      ],
    }
  }

  if (request.prompt !== undefined) {
    return {
      prompt: `${request.prompt}\n\n${instruction}`,
    }
  }

  throw new Error('LLM request requires either prompt or messages.')
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim()

  if (trimmed === '') {
    throw new Error('LLM returned empty text.')
  }

  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)

    if (fenced?.[1] !== undefined) {
      return JSON.parse(fenced[1]) as unknown
    }

    return JSON.parse(extractJsonSubstring(trimmed)) as unknown
  }
}

function extractJsonSubstring(text: string): string {
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const start = objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart)

  if (start === -1) {
    throw new Error('LLM text did not contain JSON.')
  }

  const objectEnd = text.lastIndexOf('}')
  const arrayEnd = text.lastIndexOf(']')
  const end = Math.max(objectEnd, arrayEnd)

  if (end < start) {
    throw new Error('LLM text contained incomplete JSON.')
  }

  return text.slice(start, end + 1)
}

function normalizeUsage(usage: undefined | {inputTokens?: number; outputTokens?: number; totalTokens?: number}): LLMUsage | undefined {
  if (usage === undefined) {
    return undefined
  }

  return {
    ...(usage.inputTokens === undefined ? {} : {inputTokens: usage.inputTokens}),
    ...(usage.outputTokens === undefined ? {} : {outputTokens: usage.outputTokens}),
    ...(usage.totalTokens === undefined ? {} : {totalTokens: usage.totalTokens}),
  }
}
