import type {LanguageModel, ModelMessage} from 'ai'

import {createHash, randomUUID} from 'node:crypto'
import {toJSONSchema} from 'zod'

import type {GenerateObjectRequest, GenerateTextRequest, LLMTraceOperation, LLMTraceRecord, LLMTraceRecorder, LLMUsage} from './types.js'

export interface TraceContext {
  operation: LLMTraceOperation
  requestId: string
  startedAt: string
  startedAtMs: number
}

export function startTrace(operation: LLMTraceOperation): TraceContext {
  const startedAtMs = Date.now()

  return {
    operation,
    requestId: `llm_${randomUUID()}`,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
  }
}

export async function recordAISDKTrace(input: {
  model: LanguageModel
  recorder?: LLMTraceRecorder
  request: GenerateTextRequest | GenerateObjectRequest<unknown>
  result: {error?: unknown; object?: unknown; text?: string; usage?: LLMUsage}
  trace: TraceContext
}): Promise<void> {
  if (input.recorder === undefined) {
    return
  }

  const completedAtMs = Date.now()

  try {
    await input.recorder.record({
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: completedAtMs - input.trace.startedAtMs,
      ...(input.result.error === undefined ? {} : {error: normalizeError(input.result.error)}),
      ...(readLanguageModelString(input.model, 'modelId') === undefined ? {} : {model: readLanguageModelString(input.model, 'modelId')}),
      operation: input.trace.operation,
      ...(readLanguageModelString(input.model, 'provider') === undefined ? {} : {provider: readLanguageModelString(input.model, 'provider')}),
      request: traceRequest(input.request),
      requestId: input.trace.requestId,
      ...(input.result.error === undefined ? {response: traceResponse(input.result)} : input.result.text === undefined ? {} : {response: {text: input.result.text}}),
      startedAt: input.trace.startedAt,
      status: input.result.error === undefined ? 'succeeded' : 'failed',
      ...(input.result.usage === undefined ? {} : {usage: input.result.usage}),
      version: 1,
    } satisfies LLMTraceRecord)
  } catch {
    // Tracing must never change LLM behavior.
  }
}

function traceRequest(request: GenerateTextRequest | GenerateObjectRequest<unknown>): LLMTraceRecord['request'] {
  return {
    ...(request.messages === undefined ? {} : {messages: sanitizeTraceMessages(request.messages)}),
    ...(request.prompt === undefined ? {} : {prompt: request.prompt}),
    ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
    ...(!('schema' in request) ? {} : {schema: toJSONSchema(request.schema)}),
    ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
  }
}

function sanitizeTraceMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (!('content' in message) || !Array.isArray(message.content)) {
      return message
    }

    return {
      ...message,
      content: message.content.map((part) => sanitizeTraceContentPart(part)),
    } as ModelMessage
  })
}

function sanitizeTraceContentPart(part: unknown): unknown {
  if (!isRecord(part)) {
    return part
  }

  const sanitized = {...part}

  if (shouldOmitTraceData(sanitized.data, sanitized)) {
    sanitized.data = summarizeTraceMediaData(sanitized.data)
  }

  if (shouldOmitTraceData(sanitized.image, sanitized)) {
    sanitized.image = summarizeTraceMediaData(sanitized.image)
  }

  return sanitized
}

function shouldOmitTraceData(value: unknown, part: Record<string, unknown>): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false
  }

  return value.startsWith('data:')
    || typeof part.mediaType === 'string'
    || part.type === 'file'
    || part.type === 'image'
}

function summarizeTraceMediaData(value: string): string {
  return `[omitted media payload: ${summarizeTraceMediaPayload(value)}]`
}

function summarizeTraceMediaPayload(value: string): string {
  const dataUri = /^data:([^;,]+)?(?:;base64)?,/u.exec(value)
  const mediaType = dataUri?.[1]
  const dataStart = dataUri === null ? 0 : dataUri[0].length
  const payloadChars = value.length - dataStart
  const sha256 = createHash('sha256').update(value).digest('hex')

  return [
    ...(mediaType === undefined ? [] : [`mediaType=${mediaType}`]),
    `chars=${payloadChars}`,
    `sha256=${sha256}`,
  ].join(' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
