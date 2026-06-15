import type {LanguageModel} from 'ai'

import {createAnthropic} from '@ai-sdk/anthropic'
import {createOpenAICompatible} from '@ai-sdk/openai-compatible'

import type {LLMClient} from './types.js'

import {AISDKLLMClient} from './ai-sdk-adapter.js'

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
}

export function createLLMClientFromConfig(config?: LLMClientConfig, options: LLMClientFactoryOptions = {}): LLMClient | undefined {
  if (config === undefined) {
    return undefined
  }

  return new AISDKLLMClient({
    model: createLanguageModelFromConfig(config, options),
  })
}

export function createLanguageModelFromConfig(config: LLMClientConfig, options: LLMClientFactoryOptions = {}): LanguageModel {
  assertNonEmpty('llm.model', config.model)

  if (config.provider === 'anthropic') {
    const provider = createAnthropic({
      ...(config.baseURL === undefined ? {} : {baseURL: normalizeNonEmptyString('llm.baseURL', config.baseURL)}),
      ...resolveAnthropicAuth(config, options.env ?? process.env),
      ...(config.headers === undefined ? {} : {headers: config.headers}),
      ...(config.name === undefined ? {} : {name: config.name}),
    })

    return provider(config.model)
  }

  if (config.provider === 'openai-compatible') {
    const provider = createOpenAICompatible({
      apiKey: resolveEnvValue(config.apiKeyEnv ?? config.authTokenEnv ?? 'VIDEO_AGENT_LLM_TOKEN', options.env ?? process.env),
      baseURL: normalizeNonEmptyString('llm.baseURL', config.baseURL),
      ...(config.headers === undefined ? {} : {headers: config.headers}),
      includeUsage: true,
      name: config.name ?? 'openai-compatible',
      supportsStructuredOutputs: config.supportsStructuredOutputs ?? true,
    })

    return provider(config.model)
  }

  throw new Error(`Unsupported LLM provider: ${(config as {provider: string}).provider}`)
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
