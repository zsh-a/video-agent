import type {LanguageModel} from 'ai'

import {createAnthropic} from '@ai-sdk/anthropic'
import {createOpenAICompatible} from '@ai-sdk/openai-compatible'

import type {LLMClient, LLMTraceRecorder} from './types.js'

import {AISDKLLMClient} from './ai-sdk/adapter.js'
import {bunEnv} from './bun-runtime.js'

export const ANTHROPIC_LLM_PROVIDER = 'anthropic' as const
export const DEFAULT_LLM_API_KEY_ENV = 'VIDEO_AGENT_LLM_TOKEN' as const
export const MIMO_API_KEY_ENV = 'MIMO_API_KEY' as const
export const OPENAI_COMPATIBLE_LLM_PROVIDER = 'openai-compatible' as const
export const LLM_PROVIDER_NAMES = [ANTHROPIC_LLM_PROVIDER, OPENAI_COMPATIBLE_LLM_PROVIDER] as const
export type LLMProviderName = (typeof LLM_PROVIDER_NAMES)[number]

export interface LLMClientConfig {
  apiKeyEnv?: string
  baseURL?: string
  headers?: Record<string, string>
  model: string
  name?: string
  provider: LLMProviderName
}

export interface LLMClientFactoryOptions {
  env?: Record<string, string | undefined>
  trace?: LLMTraceRecorder
}

export function createLLMClientFromConfig(config?: LLMClientConfig, options: LLMClientFactoryOptions = {}): LLMClient | undefined {
  if (config === undefined) {
    return undefined
  }

  return new AISDKLLMClient({
    model: createLanguageModelFromConfig(config, options),
    trace: options.trace,
  })
}

export function createLanguageModelFromConfig(config: LLMClientConfig, options: LLMClientFactoryOptions = {}): LanguageModel {
  assertNonEmpty('llm.model', config.model)

  if (config.provider === ANTHROPIC_LLM_PROVIDER) {
    const env = options.env ?? bunEnv()
    const apiKey = resolveApiKey(config, env)
    const provider = createAnthropic({
      ...(apiKey === undefined ? {} : {apiKey}),
      ...(config.baseURL === undefined ? {} : {baseURL: normalizeNonEmptyString('llm.baseURL', config.baseURL)}),
      ...(config.headers === undefined ? {} : {headers: config.headers}),
      ...(config.name === undefined ? {} : {name: config.name}),
    })

    return provider(config.model)
  }

  if (config.provider === OPENAI_COMPATIBLE_LLM_PROVIDER) {
    const env = options.env ?? bunEnv()
    const provider = createOpenAICompatible({
      apiKey: resolveOpenAICompatibleApiKey(config, env),
      baseURL: normalizeNonEmptyString('llm.baseURL', config.baseURL),
      ...(config.headers === undefined ? {} : {headers: config.headers}),
      includeUsage: true,
      name: config.name ?? OPENAI_COMPATIBLE_LLM_PROVIDER,
      ...(config.name === 'mimo' ? {transformRequestBody: transformMimoRequestBody} : {}),
    })

    return provider(config.model)
  }

  throw new Error(`Unsupported LLM provider: ${(config as {provider: string}).provider}`)
}

export function isLLMProviderName(value: unknown): value is LLMProviderName {
  return typeof value === 'string' && (LLM_PROVIDER_NAMES as readonly string[]).includes(value)
}

export function createMimoApiKeyEnvCandidates(config?: Pick<LLMClientConfig, 'apiKeyEnv'>): string[] {
  const names: string[] = []

  for (const candidate of [config?.apiKeyEnv, MIMO_API_KEY_ENV, DEFAULT_LLM_API_KEY_ENV]) {
    const name = candidate?.trim()

    if (name !== undefined && name !== '' && !names.includes(name)) {
      names.push(name)
    }
  }

  return names
}

function resolveOpenAICompatibleApiKey(config: LLMClientConfig, env: Record<string, string | undefined>): string | undefined {
  if (config.name === 'mimo') {
    return resolveFirstEnvValue(createMimoApiKeyEnvCandidates(config), env)
  }

  return resolveApiKey(config, env)
}

function resolveFirstEnvValue(names: Array<string | undefined>, env: Record<string, string | undefined>): string | undefined {
  for (const name of names) {
    const value = resolveEnvValue(name, env)

    if (value !== undefined) {
      return value
    }
  }

  return undefined
}

function transformMimoRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isMimoAsrRequestBody(body)) {
    return body
  }

  return {
    ...body,
    messages: Array.isArray(body.messages) ? body.messages.map((message) => transformMimoMessage(message)) : body.messages,
  }
}

function isMimoAsrRequestBody(body: Record<string, unknown>): boolean {
  return isRecord(body['asr_options'])
}

function transformMimoMessage(message: unknown): unknown {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return message
  }

  return {
    ...message,
    content: message.content.map((part) => transformMimoContentPart(part)),
  }
}

function transformMimoContentPart(part: unknown): unknown {
  if (!isRecord(part) || part.type !== 'input_audio') {
    return part
  }

  const {'input_audio': inputAudio} = part

  if (!isRecord(inputAudio)) {
    return part
  }

  const {data, format} = inputAudio

  if (typeof data !== 'string') {
    return part
  }

  const mediaType = typeof format === 'string' ? audioMimeTypeFromFormat(format) : 'audio/wav'

  return {
    ...part,
    'input_audio': {
      data: data.startsWith('data:') ? data : `data:${mediaType};base64,${data}`,
    },
  }
}

function audioMimeTypeFromFormat(format: string): string {
  if (format === 'mp3') {
    return 'audio/mpeg'
  }

  return 'audio/wav'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveApiKey(config: LLMClientConfig, env: Record<string, string | undefined>): string | undefined {
  return resolveEnvValue(config.apiKeyEnv ?? DEFAULT_LLM_API_KEY_ENV, env)
}

function resolveEnvValue(name: string | undefined, env: Record<string, string | undefined>): string | undefined {
  if (name === undefined || name.trim() === '') {
    return undefined
  }

  const value = env[name]

  return value === undefined || value.trim() === '' ? undefined : value
}

function assertNonEmpty(name: string, value: string): void {
  normalizeNonEmptyString(name, value)
}

function normalizeNonEmptyString(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} must be configured.`)
  }

  return value.trim()
}
