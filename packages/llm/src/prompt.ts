import type {z} from 'zod'

import {createHash} from 'node:crypto'

import type {GenerateObjectRequest, LLMCacheHint, LLMMessage, LLMProviderOptions} from './types.js'

export interface ObjectPromptSpec<TInput, TOutput> {
  buildMessages(input: TInput): LLMMessage[]
  cache?: (input: TInput, messages: LLMMessage[]) => LLMCacheHint | undefined
  id: string
  providerOptions?: LLMProviderOptions
  schema: z.ZodType<TOutput>
  schemaName: string
  stage: string
  temperature?: number
  version: string
}

export function createObjectPromptRequest<TInput, TOutput>(
  spec: ObjectPromptSpec<TInput, TOutput>,
  input: TInput,
): GenerateObjectRequest<TOutput> {
  const messages = spec.buildMessages(input)

  return {
    ...(spec.cache === undefined ? {} : {cache: spec.cache(input, messages)}),
    messages,
    promptMetadata: {
      id: spec.id,
      inputHash: hashPromptInput(input),
      schemaName: spec.schemaName,
      stage: spec.stage,
      version: spec.version,
    },
    ...(spec.providerOptions === undefined ? {} : {providerOptions: spec.providerOptions}),
    schema: spec.schema,
    ...(spec.temperature === undefined ? {} : {temperature: spec.temperature}),
  }
}

export function hashPromptInput(input: unknown): string {
  return createHash('sha256')
    .update(stablePromptJson(input))
    .digest('hex')
}

function stablePromptJson(value: unknown): string {
  const seen = new WeakSet<object>()

  return JSON.stringify(normalizePromptValue(value, seen))
}

function normalizePromptValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return null
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizePromptValue(item, seen))
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      throw new Error('Prompt input metadata hashing does not support circular objects.')
    }

    seen.add(value)

    const normalized = Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizePromptValue(item, seen)]))

    seen.delete(value)

    return normalized
  }

  return null
}
