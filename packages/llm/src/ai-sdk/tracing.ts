import type {LanguageModel, ModelMessage} from 'ai'

import {createHash, randomUUID} from 'node:crypto'
import {toJSONSchema} from 'zod'

import type {GenerateObjectRequest, GenerateTextRequest, LLMTraceOperation, LLMTraceRecord, LLMTraceRecorder, LLMUsage} from '../types.js'

const MAX_ERROR_TEXT_CHARS = 4000
const MAX_ERROR_STACK_CHARS = 2000
const MAX_ERROR_DETAIL_DEPTH = 3
const ERROR_DIAGNOSTIC_KEYS = [
  'cause',
  'finishReason',
  'isRetryable',
  'lastError',
  'requestBodyValues',
  'response',
  'responseBody',
  'statusCode',
  'text',
  'url',
  'usage',
  'warnings',
] as const

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
    ...(request.cache === undefined ? {} : {cache: request.cache}),
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

function normalizeError(error: unknown): NonNullable<LLMTraceRecord['error']> {
  if (error instanceof Error) {
    const details = normalizeErrorDetails(error)
    const stack = truncateDiagnosticString(error.stack, MAX_ERROR_STACK_CHARS)

    return {
      ...(details === undefined ? {} : {details}),
      message: error.message,
      name: error.name,
      ...(!isRecord(error) || typeof error.isRetryable !== 'boolean' ? {} : {retryable: error.isRetryable}),
      ...(stack === undefined ? {} : {stack}),
    }
  }

  const details = normalizeErrorDetails(error)

  return {
    ...(details === undefined ? {} : {details}),
    message: String(error),
    name: 'Error',
    ...(!isRecord(error) || typeof error.isRetryable !== 'boolean' ? {} : {retryable: error.isRetryable}),
  }
}

function normalizeErrorDetails(error: unknown): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {}

  if (isRecord(error)) {
    for (const key of ERROR_DIAGNOSTIC_KEYS) {
      if (key in error) {
        details[key] = summarizeDiagnosticValue(error[key], MAX_ERROR_DETAIL_DEPTH)
      }
    }

    const enumerable = Object.fromEntries(Object.entries(error)
      .filter(([key]) => !(key in details) && key !== 'name' && key !== 'message' && key !== 'stack')
      .map(([key, value]) => [key, summarizeDiagnosticValue(value, MAX_ERROR_DETAIL_DEPTH)]))

    if (Object.keys(enumerable).length > 0) {
      details.fields = enumerable
    }
  }

  if (error instanceof Error && error.cause !== undefined && details.cause === undefined) {
    details.cause = summarizeDiagnosticValue(error.cause, MAX_ERROR_DETAIL_DEPTH)
  }

  return Object.keys(details).length === 0 ? undefined : details
}

function summarizeDiagnosticValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return summarizeDiagnosticString(value, MAX_ERROR_TEXT_CHARS)
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return value
  }

  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      ...(value.cause === undefined || depth <= 0 ? {} : {cause: summarizeDiagnosticValue(value.cause, depth - 1)}),
    }
  }

  if (depth <= 0) {
    return summarizeOpaqueValue(value)
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => summarizeDiagnosticValue(item, depth - 1))
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .slice(0, 40)
      .map(([key, item]) => [key, summarizeDiagnosticValue(item, depth - 1)]))
  }

  return summarizeOpaqueValue(value)
}

function summarizeDiagnosticString(value: string | undefined, limit: number): string | undefined | {chars: number; preview: string; sha256: string; truncated: true} {
  if (value === undefined || value === '') {
    return undefined
  }

  if (value.length <= limit) {
    return value
  }

  return {
    chars: value.length,
    preview: value.slice(0, limit),
    sha256: createHash('sha256').update(value).digest('hex'),
    truncated: true,
  }
}

function truncateDiagnosticString(value: string | undefined, limit: number): string | undefined {
  if (value === undefined || value === '') {
    return undefined
  }

  return value.length <= limit ? value : `${value.slice(0, limit)}\n[truncated ${value.length - limit} chars]`
}

function summarizeOpaqueValue(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    return `[${Array.isArray(value) ? 'array' : 'object'}]`
  }

  return String(value)
}

function readLanguageModelString(model: LanguageModel, key: 'modelId' | 'provider'): string | undefined {
  const value = (model as Record<string, unknown>)[key]

  return typeof value === 'string' && value !== '' ? value : undefined
}
