import type {ASRProvider, TTSProvider, VLMProvider} from './contracts.js'

import {CommandASRProvider, CommandTTSProvider, CommandVLMProvider} from './command.js'
import {HttpASRProvider, HttpTTSProvider, HttpVLMProvider} from './http.js'
import {MockASRProvider, MockTTSProvider, MockVLMProvider} from './mock.js'

export type ProviderName = 'command' | 'http' | 'mock'
export type ProviderRole = 'asr' | 'tts' | 'vlm'

export interface ProviderConfig {
  providers: {
    asr: string
    tts: string
    vlm: string
  }
}

export interface ProviderRegistryOptions {
  env?: Record<string, string | undefined>
}

export interface ProviderSet {
  asr: ASRProvider
  tts: TTSProvider
  vlm: VLMProvider
}

export function createProviders(config: ProviderConfig, options: ProviderRegistryOptions = {}): ProviderSet {
  return {
    asr: createAsrProvider(config.providers.asr, options),
    tts: createTtsProvider(config.providers.tts, options),
    vlm: createVlmProvider(config.providers.vlm, options),
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
    return new HttpASRProvider(resolveHttpOptions('asr', options.env))
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
    return new HttpTTSProvider(resolveHttpOptions('tts', options.env))
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
    return new HttpVLMProvider(resolveHttpOptions('vlm', options.env))
  }

  throw new Error(`Unsupported VLM provider: ${name}`)
}

function resolveHttpOptions(role: ProviderRole, env: Record<string, string | undefined> = process.env): {headers?: Record<string, string>; timeoutMs?: number; url: string} {
  const urlEnv = `VIDEO_AGENT_${role.toUpperCase()}_URL`
  const tokenEnv = `VIDEO_AGENT_${role.toUpperCase()}_TOKEN`
  const timeoutEnv = `VIDEO_AGENT_${role.toUpperCase()}_TIMEOUT_MS`
  const url = env[urlEnv]

  if (url === undefined || url.trim() === '') {
    throw new Error(`Provider ${role} is set to http, but ${urlEnv} is not configured.`)
  }

  return {
    ...(env[tokenEnv] === undefined || env[tokenEnv]?.trim() === '' ? {} : {headers: {authorization: `Bearer ${env[tokenEnv]}`}}),
    ...(env[timeoutEnv] === undefined || env[timeoutEnv]?.trim() === '' ? {} : {timeoutMs: parseTimeout(timeoutEnv, env[timeoutEnv])}),
    url,
  }
}

function parseTimeout(envName: string, value: string | undefined): number {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer.`)
  }

  return parsed
}

function resolveCommand(role: ProviderRole, env: Record<string, string | undefined> = process.env): string[] {
  const name = `VIDEO_AGENT_${role.toUpperCase()}_COMMAND`
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
