import type {LanguageModel, ModelMessage} from 'ai'

import {generateObject, generateText, streamText} from 'ai'

import type {
  GenerateObjectRequest,
  GenerateObjectResult,
  GenerateTextRequest,
  GenerateTextResult,
  LLMClient,
  LLMEvent,
  LLMMessage,
  LLMUsage,
  StreamTextRequest,
} from './types.js'

export interface AISDKLLMClientOptions {
  model: LanguageModel
}

export class AISDKLLMClient implements LLMClient {
  constructor(private readonly options: AISDKLLMClientOptions) {}

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>> {
    const result = await generateObject({
      ...createPromptInput(request),
      model: this.options.model,
      schema: request.schema,
      ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
    })

    return {
      object: result.object,
      usage: normalizeUsage(result.usage),
    }
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const result = await generateText({
      ...createPromptInput(request),
      model: this.options.model,
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
}

function createPromptInput(request: GenerateTextRequest): {messages: ModelMessage[]} | {prompt: string} {
  if (request.messages !== undefined) {
    return {
      messages: request.messages.map((message) => toAISDKMessage(message)),
    }
  }

  if (request.prompt !== undefined) {
    return {
      prompt: request.prompt,
    }
  }

  throw new Error('LLM request requires either prompt or messages.')
}

function toAISDKMessage(message: LLMMessage): ModelMessage {
  return {
    content: message.content,
    role: message.role,
  }
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
