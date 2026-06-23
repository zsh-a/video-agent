import type {ModelMessage} from 'ai'
import type {z} from 'zod'

import {CALL_RESULT_STATUSES, type CallResultStatus} from '@video-agent/ir'

export type LLMMessageRole = 'assistant' | 'system' | 'user'

export type LLMMessage = ModelMessage
export type LLMProviderOptions = Record<string, Record<string, LLMJsonValue>>

export type LLMJsonValue = boolean | LLMJsonValue[] | null | number | string | {[key: string]: LLMJsonValue | undefined}

export interface LLMCacheHint {
  key: string
  messageIndex?: number
  mode: 'ephemeral'
}

export interface LLMPromptMetadata {
  id: string
  inputHash: string
  schemaName?: string
  stage: string
  version: string
}

export interface GenerateTextRequest {
  cache?: LLMCacheHint
  messages?: LLMMessage[]
  prompt?: string
  promptMetadata?: LLMPromptMetadata
  providerOptions?: LLMProviderOptions
  temperature?: number
}

export interface GenerateTextResult {
  text: string
  usage?: LLMUsage
}

export interface GenerateObjectRequest<T> extends GenerateTextRequest {
  schema: z.ZodType<T>
  schemaDescription?: string
}

export interface GenerateObjectResult<T> {
  object: T
  usage?: LLMUsage
}

export type StreamTextRequest = GenerateTextRequest

export type LLMEvent =
  | {
      text: string
      type: 'text'
      usage?: LLMUsage
    }
  | {
      text: string
      type: 'text-delta'
    }

export interface LLMUsage {
  cacheReadTokens?: number
  cacheWriteTokens?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export const LLM_TRACE_OPERATIONS = ['generateObject', 'generateText', 'streamText'] as const
export const LLM_TRACE_STATUSES = CALL_RESULT_STATUSES

export type LLMTraceOperation = (typeof LLM_TRACE_OPERATIONS)[number]
export type LLMTraceStatus = CallResultStatus

export interface LLMTraceRecord {
  completedAt: string
  durationMs: number
  error?: {
    details?: Record<string, unknown>
    message: string
    name: string
    retryable?: boolean
    stack?: string
  }
  model?: string
  operation: LLMTraceOperation
  provider?: string
  prompt?: LLMPromptMetadata
  request: {
    cache?: LLMCacheHint
    messages?: LLMMessage[]
    prompt?: string
    promptMetadata?: LLMPromptMetadata
    providerOptions?: LLMProviderOptions
    schema?: unknown
    schemaDescription?: string
    temperature?: number
  }
  requestId: string
  response?: {
    object?: unknown
    text?: string
  }
  startedAt: string
  status: LLMTraceStatus
  usage?: LLMUsage
  version: 1
}

export interface LLMTraceRecorder {
  record(trace: LLMTraceRecord): Promise<void> | void
}

export interface LLMClient {
  generateObject<T>(request: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>>
  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>
  streamText(request: StreamTextRequest): AsyncIterable<LLMEvent>
}
