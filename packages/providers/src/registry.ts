import type {ASRProvider, TTSProvider, VLMProvider} from './contracts.js'
import type {ProviderFetch} from './http.js'

import {CommandASRProvider, CommandTTSProvider, CommandVLMProvider} from './command.js'
import {providerEnvName, type ProviderRole} from './descriptors.js'
import {HttpASRProvider, HttpTTSProvider, HttpVLMProvider} from './http.js'
import {MockASRProvider, MockTTSProvider, MockVLMProvider} from './mock.js'

export {
  BUILTIN_PROVIDER_NAMES,
  getProviderDescriptor,
  getProviderEnvironmentDefinitions,
  isProviderName,
  PROVIDER_DESCRIPTORS,
  PROVIDER_ROLES,
  providerEnvName,
} from './descriptors.js'
export type {ProviderDescriptor, ProviderEnvironmentDefinition, ProviderName, ProviderRequirementKind, ProviderRole} from './descriptors.js'
export {
  getProviderProfile,
  isProviderProfileName,
  MIMO_PROVIDER_BASE_URL,
  MIMO_PROVIDER_MODELS,
  MIMO_PROVIDER_PROFILE,
  PROVIDER_PROFILE_NAMES,
  PROVIDER_PROFILES,
} from './profiles.js'
export type {ProviderProfile, ProviderProfileModel, ProviderProfileName} from './profiles.js'

export interface ProviderConfig {
  providerEnv?: Record<string, string | undefined>
  providers: {
    asr: string
    tts: string
    vlm: string
  }
}

export interface ProviderRegistryOptions {
  env?: Record<string, string | undefined>
  fetch?: ProviderFetch
}

export interface ProviderSet {
  asr: ASRProvider
  tts: TTSProvider
  vlm: VLMProvider
}

export function createProviders(config: ProviderConfig, options: ProviderRegistryOptions = {}): ProviderSet {
  const mergedOptions = mergeProviderRegistryOptions(config, options)

  return {
    asr: createAsrProvider(config.providers.asr, mergedOptions),
    tts: createTtsProvider(config.providers.tts, mergedOptions),
    vlm: createVlmProvider(config.providers.vlm, mergedOptions),
  }
}

export function createAsrProvider(name: string, options: ProviderRegistryOptions = {}): ASRProvider {
  if (name === 'mock') {
    return new MockASRProvider()
  }

  if (name === 'command') {
    return new CommandASRProvider({
      command: resolveCommand('asr', options.env),
    })
  }

  if (name === 'http') {
    return new HttpASRProvider(resolveHttpOptions('asr', options))
  }

  throw new Error(`Unsupported ASR provider: ${name}`)
}

export function createTtsProvider(name: string, options: ProviderRegistryOptions = {}): TTSProvider {
  if (name === 'mock') {
    return new MockTTSProvider()
  }

  if (name === 'command') {
    return new CommandTTSProvider({
      command: resolveCommand('tts', options.env),
    })
  }

  if (name === 'http') {
    return new HttpTTSProvider(resolveHttpOptions('tts', options))
  }

  throw new Error(`Unsupported TTS provider: ${name}`)
}

export function createVlmProvider(name: string, options: ProviderRegistryOptions = {}): VLMProvider {
  if (name === 'mock') {
    return new MockVLMProvider()
  }

  if (name === 'command') {
    return new CommandVLMProvider({
      command: resolveCommand('vlm', options.env),
    })
  }

  if (name === 'http') {
    return new HttpVLMProvider(resolveHttpOptions('vlm', options))
  }

  throw new Error(`Unsupported VLM provider: ${name}`)
}

function mergeProviderRegistryOptions(config: ProviderConfig, options: ProviderRegistryOptions): ProviderRegistryOptions {
  return {
    ...options,
    env: {
      ...config.providerEnv,
      ...(options.env ?? process.env),
    },
  }
}

function resolveHttpOptions(role: ProviderRole, options: ProviderRegistryOptions): {fetch?: ProviderFetch; headers?: Record<string, string>; model?: string; timeoutMs?: number; url: string} {
  const env = options.env ?? process.env
  const urlEnv = providerEnvName(role, 'URL')
  const tokenEnv = providerEnvName(role, 'TOKEN')
  const headersEnv = providerEnvName(role, 'HEADERS')
  const modelEnv = providerEnvName(role, 'MODEL')
  const timeoutEnv = providerEnvName(role, 'TIMEOUT_MS')
  const url = env[urlEnv]

  if (url === undefined || url.trim() === '') {
    throw new Error(`Provider ${role} is set to http, but ${urlEnv} is not configured.`)
  }

  return {
    ...(options.fetch === undefined ? {} : {fetch: options.fetch}),
    ...resolveHttpHeaders({headersEnv, headersValue: env[headersEnv], tokenEnv, tokenValue: env[tokenEnv]}),
    ...(env[modelEnv] === undefined || env[modelEnv]?.trim() === '' ? {} : {model: env[modelEnv]}),
    ...(env[timeoutEnv] === undefined || env[timeoutEnv]?.trim() === '' ? {} : {timeoutMs: parseTimeout(timeoutEnv, env[timeoutEnv])}),
    url,
  }
}

function resolveHttpHeaders(options: {headersEnv: string; headersValue: string | undefined; tokenEnv: string; tokenValue: string | undefined}): {headers?: Record<string, string>} {
  const headers = {
    ...parseHeaderEnv(options.headersEnv, options.headersValue),
    ...(options.tokenValue === undefined || options.tokenValue.trim() === '' ? {} : {authorization: `Bearer ${options.tokenValue}`}),
  }

  return Object.keys(headers).length === 0 ? {} : {headers}
}

function parseHeaderEnv(envName: string, value: string | undefined): Record<string, string> {
  if (value === undefined || value.trim() === '') {
    return {}
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`${envName} must be a JSON object of string header names to string values: ${message}`)
  }

  if (!isHeaderRecord(parsed)) {
    throw new Error(`${envName} must be a JSON object of string header names to string values.`)
  }

  return parsed
}

function isHeaderRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.entries(value).every(([key, headerValue]) => key.trim() !== '' && typeof headerValue === 'string')
}

function parseTimeout(envName: string, value: string | undefined): number {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer.`)
  }

  return parsed
}

function resolveCommand(role: ProviderRole, env: Record<string, string | undefined> = process.env): string[] {
  const name = providerEnvName(role, 'COMMAND')
  const value = env[name]

  if (value === undefined || value.trim() === '') {
    throw new Error(`Provider ${role} is set to command, but ${name} is not configured.`)
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`${name} must be a JSON array of command arguments: ${message}`)
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== 'string' || part.length === 0)) {
    throw new Error(`${name} must be a non-empty JSON array of strings.`)
  }

  return parsed
}
