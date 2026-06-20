import type {LanguageModel, ModelMessage} from 'ai'

import {generateObject, generateText, streamText} from 'ai'

import type {
  GenerateObjectRequest,
  GenerateObjectResult,
  GenerateTextRequest,
  GenerateTextResult,
  LLMClient,
  LLMEvent,
  LLMTraceRecorder,
  LLMUsage,
  StreamTextRequest,
} from '../types.js'

import {createJsonFallbackRequest, createJsonTextRepairRequest, parseJsonFromText, shouldFallbackToJsonText} from './json-fallback.js'
import {recordAISDKTrace, startTrace, type TraceContext} from './tracing.js'
import {normalizeUsage} from './usage.js'

const JSON_TEXT_REPAIR_ATTEMPTS = 2

export interface AISDKLLMClientOptions {
  model: LanguageModel
  structuredOutputs?: boolean
  trace?: LLMTraceRecorder
}

export class AISDKLLMClient implements LLMClient {
  constructor(private readonly options: AISDKLLMClientOptions) {}

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>> {
    if (this.options.structuredOutputs === false) {
      return this.generateObjectFromJsonText(request, {
        operation: 'generateObjectJsonText',
      })
    }

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
      return this.generateObjectFromJsonText(request, {
        operation: 'generateObjectFallbackText',
        originalError: error,
      })
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

  private async generateObjectFromJsonText<T>(
    request: GenerateObjectRequest<T>,
    options: {
      operation: 'generateObjectFallbackText' | 'generateObjectJsonText'
      originalError?: unknown
    },
  ): Promise<GenerateObjectResult<T>> {
    return this.generateObjectFromJsonTextAttempt(request, createJsonFallbackRequest(request), options, 0)
  }

  private async generateObjectFromJsonTextAttempt<T>(
    request: GenerateObjectRequest<T>,
    currentRequest: GenerateTextRequest,
    options: {
      operation: 'generateObjectFallbackText' | 'generateObjectJsonText'
      originalError?: unknown
    },
    attempt: number,
  ): Promise<GenerateObjectResult<T>> {
    const trace = startTrace(options.operation)
    let result: Awaited<ReturnType<typeof generateText>>

    try {
      result = await generateText({
        ...createPromptInput(currentRequest),
        model: this.options.model,
        ...(currentRequest.providerOptions === undefined ? {} : {providerOptions: currentRequest.providerOptions}),
        ...(currentRequest.temperature === undefined ? {} : {temperature: currentRequest.temperature}),
      })
    } catch (error) {
      await this.recordTrace(trace, currentRequest, {error})
      throw error
    }

    try {
      const output = {
        object: request.schema.parse(parseJsonFromText(result.text)),
        usage: normalizeUsage(result.usage),
      }

      await this.recordTrace(trace, currentRequest, {
        object: output.object,
        text: result.text,
        usage: output.usage,
      })

      return output
    } catch (error) {
      await this.recordTrace(trace, currentRequest, {
        error,
        text: result.text,
        usage: normalizeUsage(result.usage),
      })

      if (attempt >= JSON_TEXT_REPAIR_ATTEMPTS) {
        throw new Error(jsonObjectFailureMessage(options.operation, error), {
          cause: options.originalError,
        })
      }

      return this.generateObjectFromJsonTextAttempt(
        request,
        createJsonTextRepairRequest(currentRequest, {
          attemptsRemaining: JSON_TEXT_REPAIR_ATTEMPTS - attempt,
          invalidText: result.text,
          parseError: error instanceof Error ? error.message : String(error),
        }),
        options,
        attempt + 1,
      )
    }
  }

  private async recordTrace(
    trace: TraceContext,
    request: GenerateTextRequest | GenerateObjectRequest<unknown>,
    result: {error?: unknown; object?: unknown; text?: string; usage?: LLMUsage},
  ): Promise<void> {
    await recordAISDKTrace({
      model: this.options.model,
      recorder: this.options.trace,
      request,
      result,
      trace,
    })
  }
}

function jsonObjectFailureMessage(operation: 'generateObjectFallbackText' | 'generateObjectJsonText', error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)

  return operation === 'generateObjectFallbackText'
    ? `LLM JSON fallback failed after structured object generation failed: ${detail}`
    : `LLM JSON text object generation failed: ${detail}`
}

function createPromptInput(request: GenerateTextRequest): {messages: ModelMessage[]} | {prompt: string} {
  if (request.messages !== undefined) {
    return {
      messages: applyCacheHintToMessages(request.messages, request.cache),
    }
  }

  if (request.prompt !== undefined) {
    return {
      prompt: request.prompt,
    }
  }

  throw new Error('LLM request requires either prompt or messages.')
}

function applyCacheHintToMessages(messages: ModelMessage[], cache: GenerateTextRequest['cache']): ModelMessage[] {
  if (cache === undefined) {
    return messages
  }

  const messageIndex = cache.messageIndex ?? messages.length - 1

  if (messageIndex < 0 || messageIndex >= messages.length) {
    return messages
  }

  return messages.map((message, index) => index === messageIndex
    ? {
        ...message,
        providerOptions: {
          ...message.providerOptions,
          anthropic: {
            ...message.providerOptions?.anthropic,
            cacheControl: {type: cache.mode},
          },
        },
      } as ModelMessage
    : message)
}
