import {
  DEFAULT_LLM_API_KEY_ENV,
  MIMO_API_KEY_ENV,
  OPENAI_COMPATIBLE_LLM_PROVIDER,
  createLLMClientFromConfig,
  createMimoApiKeyEnvCandidates,
  type LLMClient,
  type LLMClientConfig,
  type LLMTraceRecorder,
} from '@video-agent/llm'

import type {ASRProvider, ScriptProvider, TTSProvider, VLMProvider} from './contracts.js'

import {bunEnv} from './bun-runtime.js'
import {CommandASRProvider, CommandTTSProvider, CommandVLMProvider} from './command.js'
import {resolveProviderCommandArgv} from './command-env.js'
import {type ProviderName, type ProviderRole} from './descriptors.js'
import {LLMASRProvider, LLMTTSProvider, LLMVLMProvider, MIMO_ASR_BASE_URL, MIMO_ASR_MODEL, MIMO_TTS_BASE_URL, MIMO_TTS_DEFAULT_VOICE, MIMO_TTS_MODEL, MimoASRProvider, MimoTTSProvider} from './llm/media.js'
import {MockASRProvider, MockTTSProvider, MockVLMProvider} from './mock.js'
import {LLMScriptProvider} from './planning.js'

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
    asr: ProviderName
    tts: ProviderName
    vlm: ProviderName
  }
}

export interface ProviderRegistryOptions {
  env?: Record<string, string | undefined>
  fetch?: typeof fetch
  llmClient?: LLMClient
  llmConfig?: LLMClientConfig
  llmTrace?: LLMTraceRecorder
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

export function createAsrProvider(name: ProviderName, options: ProviderRegistryOptions = {}): ASRProvider {
  switch (name) {
    case 'mock':
      return new MockASRProvider()
    case 'command':
      return new CommandASRProvider({
        command: resolveCommand('asr', options.env),
      })
    case 'llm': {
      const mimoAsrClient = createMimoAsrClient(options)

      return mimoAsrClient === undefined ? new LLMASRProvider(resolveLLMClient('asr', options)) : new MimoASRProvider(mimoAsrClient)
    }
  }

  return throwUnsupportedProvider('ASR', name)
}

export function createScriptProvider(options: ProviderRegistryOptions = {}): ScriptProvider {
  const llmClient = resolveOptionalLLMClient(options)

  if (llmClient === undefined) {
    throw new Error('Film Recap semantic planning requires an LLM provider. Configure an llm block or pass an injected LLM client.')
  }

  return new LLMScriptProvider(llmClient)
}

export function createTtsProvider(name: ProviderName, options: ProviderRegistryOptions = {}): TTSProvider {
  switch (name) {
    case 'mock':
      return new MockTTSProvider()
    case 'command':
      return new CommandTTSProvider({
        command: resolveCommand('tts', options.env),
      })
    case 'llm': {
      const mimoTtsProvider = createMimoTtsProvider(options)

      return mimoTtsProvider ?? new LLMTTSProvider(resolveLLMClient('tts', options))
    }
  }

  return throwUnsupportedProvider('TTS', name)
}

export function createVlmProvider(name: ProviderName, options: ProviderRegistryOptions = {}): VLMProvider {
  switch (name) {
    case 'mock':
      return new MockVLMProvider()
    case 'command':
      return new CommandVLMProvider({
        command: resolveCommand('vlm', options.env),
      })
    case 'llm':
      return new LLMVLMProvider(resolveLLMClient('vlm', options))
  }

  return throwUnsupportedProvider('VLM', name)
}

function throwUnsupportedProvider(role: string, name: never): never {
  throw new Error(`Unsupported ${role} provider: ${String(name)}`)
}

function mergeProviderRegistryOptions(config: ProviderConfig, options: ProviderRegistryOptions): ProviderRegistryOptions {
  const env = {
    ...config.providerEnv,
    ...(options.env ?? bunEnv()),
  }
  const llmConfig = options.llmConfig ?? config.llm
  const mergedOptions = {
    ...options,
    env,
    llmConfig,
  }

  return {
    ...mergedOptions,
    llmClient: resolveOptionalLLMClient(mergedOptions),
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
    provider: OPENAI_COMPATIBLE_LLM_PROVIDER,
  }, {
    env,
    trace: options.llmTrace,
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
    throw new Error(`Provider tts is set to llm with Mimo profile, but Mimo API key is not configured. Set ${MIMO_API_KEY_ENV} or ${DEFAULT_LLM_API_KEY_ENV}.`)
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
  for (const name of createMimoApiKeyEnvCandidates(config)) {
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
  const llmClient = resolveOptionalLLMClient(options)

  if (llmClient === undefined) {
    throw new Error(`Provider ${role} is set to llm, but LLM is not configured.`)
  }

  return llmClient
}

function resolveOptionalLLMClient(options: ProviderRegistryOptions): LLMClient | undefined {
  return options.llmClient ?? createLLMClientFromConfig(options.llmConfig, {
    env: options.env ?? bunEnv(),
    trace: options.llmTrace,
  })
}

function resolveCommand(role: ProviderRole, env: Record<string, string | undefined> = bunEnv()): string[] {
  return resolveProviderCommandArgv(role, env)
}
