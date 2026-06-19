import type {LanguageModel} from 'ai'

import {createAnthropic} from '@ai-sdk/anthropic'
import {createOpenAICompatible} from '@ai-sdk/openai-compatible'

import type {LLMClient, LLMTraceRecorder} from './types.js'

import {AISDKLLMClient} from './ai-sdk/adapter.js'
import {bunEnv} from './bun-runtime.js'

export type LLMProviderName = 'anthropic' | 'openai-compatible'

export interface LLMClientConfig {
  apiKeyEnv?: string
  authTokenEnv?: string
  baseURL?: string
  headers?: Record<string, string>
  model: string
  name?: string
  provider: LLMProviderName
  supportsStructuredOutputs?: boolean
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

  if (config.provider === 'anthropic') {
    const provider = createAnthropic({
      ...(config.baseURL === undefined ? {} : {baseURL: normalizeNonEmptyString('llm.baseURL', config.baseURL)}),
      ...resolveAnthropicAuth(config, options.env ?? bunEnv()),
      ...(config.headers === undefined ? {} : {headers: config.headers}),
      ...(config.name === undefined ? {} : {name: config.name}),
    })

    return provider(config.model)
  }

  if (config.provider === 'openai-compatible') {
    const env = options.env ?? bunEnv()
    const provider = createOpenAICompatible({
      apiKey: resolveOpenAICompatibleApiKey(config, env),
      baseURL: normalizeNonEmptyString('llm.baseURL', config.baseURL),
      ...(config.headers === undefined ? {} : {headers: config.headers}),
      includeUsage: true,
      name: config.name ?? 'openai-compatible',
      supportsStructuredOutputs: config.supportsStructuredOutputs ?? true,
      ...(config.name === 'mimo' ? {transformRequestBody: transformMimoRequestBody} : {}),
    })

    return provider(config.model)
  }

  throw new Error(`Unsupported LLM provider: ${(config as {provider: string}).provider}`)
}

function resolveOpenAICompatibleApiKey(config: LLMClientConfig, env: Record<string, string | undefined>): string | undefined {
  if (config.name === 'mimo') {
    return resolveFirstEnvValue([
      config.apiKeyEnv,
      config.authTokenEnv,
      'MIMO_API_KEY',
      'VIDEO_AGENT_LLM_TOKEN',
    ], env)
  }

  return resolveEnvValue(config.apiKeyEnv ?? config.authTokenEnv ?? 'VIDEO_AGENT_LLM_TOKEN', env)
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

function resolveAnthropicAuth(config: LLMClientConfig, env: Record<string, string | undefined>): {apiKey?: string; authToken?: string} {
  const authToken = resolveEnvValue(config.authTokenEnv, env)

  if (authToken !== undefined) {
    return {authToken}
  }

  const apiKey = resolveEnvValue(config.apiKeyEnv, env)

  return apiKey === undefined ? {} : {apiKey}
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
