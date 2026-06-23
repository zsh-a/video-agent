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

import {recordAISDKTrace, startTrace, type TraceContext} from './tracing.js'
import {normalizeUsage} from './usage.js'

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
        ...(request.schemaDescription === undefined ? {} : {schemaDescription: request.schemaDescription}),
        ...(request.promptMetadata?.schemaName === undefined ? {} : {schemaName: request.promptMetadata.schemaName}),
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
      await this.recordTrace(trace, request, {error})
      throw error
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
