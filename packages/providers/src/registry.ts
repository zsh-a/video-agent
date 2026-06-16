import {createLLMClientFromConfig, type LLMClient, type LLMClientConfig} from '@video-agent/llm'

import type {ASRProvider, ScriptProvider, StoryboardProvider, TTSProvider, VLMProvider} from './contracts.js'

import {bunEnv} from './bun-runtime.js'
import {CommandASRProvider, CommandTTSProvider, CommandVLMProvider} from './command.js'
import {providerEnvName, type ProviderRole} from './descriptors.js'
import {LLMASRProvider, LLMTTSProvider, LLMVLMProvider, MIMO_ASR_BASE_URL, MIMO_ASR_MODEL, MIMO_TTS_BASE_URL, MIMO_TTS_DEFAULT_VOICE, MIMO_TTS_MODEL, MimoASRProvider, MimoTTSProvider} from './llm-media.js'
import {MockASRProvider, MockTTSProvider, MockVLMProvider} from './mock.js'
import {DeterministicScriptProvider, DeterministicStoryboardProvider, LLMScriptProvider, LLMStoryboardProvider} from './planning.js'

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
  MIMO_PROVIDER_MODEL_IDS,
  MIMO_PROVIDER_MODELS,
  MIMO_PROVIDER_PROFILE,
  PROVIDER_PROFILE_NAMES,
  PROVIDER_PROFILES,
} from './profiles.js'
export type {ProviderProfile, ProviderProfileModel, ProviderProfileName, ProviderRoleSettings, ProviderSettings} from './profiles.js'

export interface ProviderConfig {
  llm?: LLMClientConfig
  providerEnv?: Record<string, string | undefined>
  providers: {
    asr: string
    tts: string
    vlm: string
  }
}

export interface ProviderRegistryOptions {
  env?: Record<string, string | undefined>
  fetch?: typeof fetch
  llmClient?: LLMClient
  llmConfig?: LLMClientConfig
}

export interface ProviderSet {
  asr: ASRProvider
  script: ScriptProvider
  storyboard: StoryboardProvider
  tts: TTSProvider
  vlm: VLMProvider
}

export function createProviders(config: ProviderConfig, options: ProviderRegistryOptions = {}): ProviderSet {
  const mergedOptions = mergeProviderRegistryOptions(config, options)

  return {
    asr: createAsrProvider(config.providers.asr, mergedOptions),
    script: createScriptProvider(mergedOptions),
    storyboard: createStoryboardProvider(mergedOptions),
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

  if (name === 'llm') {
    const mimoAsrClient = createMimoAsrClient(options)

    if (mimoAsrClient !== undefined) {
      return new MimoASRProvider(mimoAsrClient)
    }

    return new LLMASRProvider(resolveLLMClient('asr', options))
  }

  throw new Error(`Unsupported ASR provider: ${name}`)
}

export function createScriptProvider(options: ProviderRegistryOptions = {}): ScriptProvider {
  return options.llmClient === undefined ? new DeterministicScriptProvider() : new LLMScriptProvider(options.llmClient)
}

export function createStoryboardProvider(options: ProviderRegistryOptions = {}): StoryboardProvider {
  return options.llmClient === undefined ? new DeterministicStoryboardProvider() : new LLMStoryboardProvider(options.llmClient)
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

  if (name === 'llm') {
    const mimoTtsProvider = createMimoTtsProvider(options)

    if (mimoTtsProvider !== undefined) {
      return mimoTtsProvider
    }

    return new LLMTTSProvider(resolveLLMClient('tts', options))
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

  if (name === 'llm') {
    return new LLMVLMProvider(resolveLLMClient('vlm', options))
  }

  throw new Error(`Unsupported VLM provider: ${name}`)
}

function mergeProviderRegistryOptions(config: ProviderConfig, options: ProviderRegistryOptions): ProviderRegistryOptions {
  return {
    ...options,
    env: {
      ...config.providerEnv,
      ...(options.env ?? bunEnv()),
    },
    llmConfig: config.llm,
  }
}

function createMimoAsrClient(options: ProviderRegistryOptions): LLMClient | undefined {
  if (options.llmConfig?.name !== 'mimo') {
    return undefined
  }

  const env = options.env ?? bunEnv()
  const client = createLLMClientFromConfig({
    ...options.llmConfig,
    baseURL: MIMO_ASR_BASE_URL,
    model: MIMO_ASR_MODEL,
    provider: 'openai-compatible',
  }, {
    env,
  })

  if (client === undefined) {
    throw new Error('Provider asr is set to llm with Mimo profile, but LLM is not configured.')
  }

  return client
}

function createMimoTtsProvider(options: ProviderRegistryOptions): MimoTTSProvider | undefined {
  if (options.llmConfig?.name !== 'mimo') {
    return undefined
  }

  const env = options.env ?? bunEnv()
  const apiKey = resolveMimoApiKey(options.llmConfig, env)

  if (apiKey === undefined) {
    throw new Error('Provider tts is set to llm with Mimo profile, but Mimo API key is not configured. Set VIDEO_AGENT_LLM_TOKEN or MIMO_API_KEY.')
  }

  return new MimoTTSProvider({
    apiKey,
    baseURL: MIMO_TTS_BASE_URL,
    fetch: options.fetch,
    model: resolveOptionalEnv(env, 'VIDEO_AGENT_TTS_MIMO_MODEL') ?? MIMO_TTS_MODEL,
    style: resolveOptionalEnv(env, 'VIDEO_AGENT_TTS_MIMO_STYLE'),
    voice: resolveOptionalEnv(env, 'VIDEO_AGENT_TTS_MIMO_VOICE') ?? MIMO_TTS_DEFAULT_VOICE,
  })
}

function resolveMimoApiKey(config: LLMClientConfig, env: Record<string, string | undefined>): string | undefined {
  const names = [
    config.apiKeyEnv,
    config.authTokenEnv,
    'MIMO_API_KEY',
    'VIDEO_AGENT_LLM_TOKEN',
  ].filter((name, index, names): name is string => typeof name === 'string' && name.trim() !== '' && names.indexOf(name) === index)

  for (const name of names) {
    const value = resolveOptionalEnv(env, name)

    if (value !== undefined) {
      return value
    }
  }

  return undefined
}

function resolveOptionalEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]

  return value === undefined || value.trim() === '' ? undefined : value.trim()
}

function resolveLLMClient(role: ProviderRole, options: ProviderRegistryOptions): LLMClient {
  if (options.llmClient === undefined) {
    throw new Error(`Provider ${role} is set to llm, but LLM is not configured.`)
  }

  return options.llmClient
}

function resolveCommand(role: ProviderRole, env: Record<string, string | undefined> = bunEnv()): string[] {
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
