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
  LLMTraceOperation,
  LLMTraceRecorder,
  LLMUsage,
  StreamTextRequest,
} from './types.js'

import {randomUUID} from 'node:crypto'

export interface AISDKLLMClientOptions {
  model: LanguageModel
  trace?: LLMTraceRecorder
}

export class AISDKLLMClient implements LLMClient {
  constructor(private readonly options: AISDKLLMClientOptions) {}

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>> {
    const trace = startTrace('generateObject')

    try {
      const result = await generateObject({
        ...createPromptInput(request),
        model: this.options.model,
        ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
        schema: request.schema,
        ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
      })

      const output = {
        object: result.object,
        usage: normalizeUsage(result.usage),
      }

      await this.recordTrace(trace, request, {
        object: output.object,
        usage: output.usage,
      })

      return output
    } catch (error) {
      if (!shouldFallbackToJsonText(error)) {
        await this.recordTrace(trace, request, {error})
        throw error
      }

      await this.recordTrace(trace, request, {error})
      return this.generateObjectFromJsonText(request, error)
    }
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const trace = startTrace('generateText')

    try {
      const result = await generateText({
        ...createPromptInput(request),
        model: this.options.model,
        ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
        ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
      })
      const output = {
        text: result.text,
        usage: normalizeUsage(result.usage),
      }

      await this.recordTrace(trace, request, {
        text: output.text,
        usage: output.usage,
      })

      return output
    } catch (error) {
      await this.recordTrace(trace, request, {error})
      throw error
    }
  }

  async *streamText(request: StreamTextRequest): AsyncIterable<LLMEvent> {
    const trace = startTrace('streamText')

    try {
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

      const text = await result.text
      const usage = normalizeUsage(await result.usage)

      await this.recordTrace(trace, request, {
        text,
        usage,
      })

      yield {
        text,
        type: 'text',
        usage,
      }
    } catch (error) {
      await this.recordTrace(trace, request, {error})
      throw error
    }
  }

  private async generateObjectFromJsonText<T>(request: GenerateObjectRequest<T>, originalError: unknown): Promise<GenerateObjectResult<T>> {
    const trace = startTrace('generateObjectFallbackText')
    const fallbackRequest = createJsonFallbackRequest(request)

    let result: Awaited<ReturnType<typeof generateText>>

    try {
      result = await generateText({
        ...createPromptInput(fallbackRequest),
        model: this.options.model,
        ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
        ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
      })
    } catch (error) {
      await this.recordTrace(trace, fallbackRequest, {error})
      throw error
    }

    try {
      const output = {
        object: request.schema.parse(parseJsonFromText(result.text)),
        usage: normalizeUsage(result.usage),
      }

      await this.recordTrace(trace, fallbackRequest, {
        object: output.object,
        text: result.text,
        usage: output.usage,
      })

      return output
    } catch (error) {
      await this.recordTrace(trace, fallbackRequest, {
        error,
        text: result.text,
        usage: normalizeUsage(result.usage),
      })

      throw new Error(`LLM JSON fallback failed after structured object generation failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: originalError,
      })
    }
  }

  private async recordTrace(
    trace: TraceContext,
    request: GenerateTextRequest | GenerateObjectRequest<unknown>,
    result: {error?: unknown; object?: unknown; text?: string; usage?: LLMUsage},
  ): Promise<void> {
    if (this.options.trace === undefined) {
      return
    }

    const completedAtMs = Date.now()

    try {
      await this.options.trace.record({
        completedAt: new Date(completedAtMs).toISOString(),
        durationMs: completedAtMs - trace.startedAtMs,
        ...(result.error === undefined ? {} : {error: normalizeError(result.error)}),
        ...(readLanguageModelString(this.options.model, 'modelId') === undefined ? {} : {model: readLanguageModelString(this.options.model, 'modelId')}),
        operation: trace.operation,
        ...(readLanguageModelString(this.options.model, 'provider') === undefined ? {} : {provider: readLanguageModelString(this.options.model, 'provider')}),
        request: traceRequest(request),
        requestId: trace.requestId,
        ...(result.error === undefined ? {response: traceResponse(result)} : result.text === undefined ? {} : {response: {text: result.text}}),
        startedAt: trace.startedAt,
        status: result.error === undefined ? 'succeeded' : 'failed',
        ...(result.usage === undefined ? {} : {usage: result.usage}),
        version: 1,
      })
    } catch {
      // Tracing must never change LLM behavior.
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

function createJsonFallbackRequest<T>(request: GenerateObjectRequest<T>): GenerateTextRequest {
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
      ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
      ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
    }
  }

  if (request.prompt !== undefined) {
    return {
      prompt: `${request.prompt}\n\n${instruction}`,
      ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
      ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
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
    return parseJsonCandidate(trimmed)
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)

    if (fenced?.[1] !== undefined) {
      return parseJsonCandidate(fenced[1])
    }

    return parseJsonCandidate(extractJsonSubstring(trimmed))
  }
}

function parseJsonCandidate(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    const repaired = repairCommonLLMJson(text)

    if (repaired !== text) {
      return JSON.parse(repaired) as unknown
    }

    throw error
  }
}

function repairCommonLLMJson(text: string): string {
  return text.replace(
    /("comparison"\s*:\s*\{\s*"left"\s*:\s*\{[\s\S]*?\}\s*,)\s*\{\s*("label"\s*:)/g,
    '$1 "right": { $2',
  )
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

interface TraceContext {
  operation: LLMTraceOperation
  requestId: string
  startedAt: string
  startedAtMs: number
}

function startTrace(operation: LLMTraceOperation): TraceContext {
  const startedAtMs = Date.now()

  return {
    operation,
    requestId: `llm_${randomUUID()}`,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
  }
}

function traceRequest(request: GenerateTextRequest | GenerateObjectRequest<unknown>): {
  messages?: ModelMessage[]
  prompt?: string
  providerOptions?: GenerateTextRequest['providerOptions']
  schema?: unknown
  temperature?: number
} {
  return {
    ...(request.messages === undefined ? {} : {messages: request.messages}),
    ...(request.prompt === undefined ? {} : {prompt: request.prompt}),
    ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
    ...(!('schema' in request) ? {} : {schema: toJSONSchema(request.schema)}),
    ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
  }
}

function traceResponse(result: {object?: unknown; text?: string}): {object?: unknown; text?: string} {
  return {
    ...(result.object === undefined ? {} : {object: result.object}),
    ...(result.text === undefined ? {} : {text: result.text}),
  }
}

function normalizeError(error: unknown): {message: string; name: string} {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    }
  }

  return {
    message: String(error),
    name: 'Error',
  }
}

function readLanguageModelString(model: LanguageModel, key: 'modelId' | 'provider'): string | undefined {
  const value = (model as Record<string, unknown>)[key]

  return typeof value === 'string' && value !== '' ? value : undefined
}
