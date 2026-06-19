import type {LLMClientConfig, LLMProviderName} from '@video-agent/llm'

import {getProviderProfile, type ProviderProfileName, type ProviderSettings} from '@video-agent/providers'
import {mkdir} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

import {bunFile, bunWrite} from './bun-runtime.js'

export type {LLMClientConfig, LLMProviderName} from '@video-agent/llm'
export type {ProviderSettings} from '@video-agent/providers'

export interface AgentConfig {
  llm?: LLMClientConfig
  persistence: {
    jobStore: JobStoreKind
  }
  pipeline: {
    maxStageRetries: number
    retryBackoffMs: number
  }
  providerProfile?: ProviderProfileName
  providers: {
    asr: string
    tts: string
    vlm: string
  }
  providerSettings: ProviderSettings
  version: 1
}

export type JobStoreKind = 'json' | 'sqlite'

export interface ConfigUpdate {
  asr?: string
  jobStore?: JobStoreKind
  llm?: null | Partial<LLMClientConfig>
  llmProvider?: LLMProviderName
  maxStageRetries?: number
  providerProfile?: ProviderProfileName
  providerSettings?: ProviderSettings
  retryBackoffMs?: number
  tts?: string
  vlm?: string
}

interface StoredAgentConfig {
  llm?: LLMClientConfig
  persistence?: {
    jobStore?: JobStoreKind
  }
  pipeline?: {
    maxStageRetries?: number
    retryBackoffMs?: number
  }
  providerProfile?: ProviderProfileName
  providers?: {
    asr?: string
    tts?: string
    vlm?: string
  }
  providerSettings?: ProviderSettings
  version?: 1
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  persistence: {
    jobStore: 'json',
  },
  pipeline: {
    maxStageRetries: 0,
    retryBackoffMs: 0,
  },
  providers: {
    asr: 'mock',
    tts: 'mock',
    vlm: 'mock',
  },
  providerSettings: {},
  version: 1,
}

export function resolveConfigPath(workspaceDir = '.video-agent'): string {
  return resolve(workspaceDir, 'config.json')
}

export async function readConfig(workspaceDir = '.video-agent'): Promise<AgentConfig> {
  const path = resolveConfigPath(workspaceDir)

  if (!await bunFile(path).exists()) {
    return DEFAULT_AGENT_CONFIG
  }

  return normalizeConfig(await bunFile(path).json<StoredAgentConfig>())
}

export async function writeConfig(workspaceDir: string, update: ConfigUpdate): Promise<{config: AgentConfig; path: string}> {
  const path = resolveConfigPath(workspaceDir)
  const current = await readStoredConfig(workspaceDir)
  const profileReset = update.providerProfile !== undefined
  const base: StoredAgentConfig = profileReset
    ? {
        providerProfile: update.providerProfile,
        version: 1,
      }
    : {
        ...current,
        version: 1,
      }

  const stored = compactStoredConfig({
    ...base,
    llm: update.llm === null
      ? undefined
      : mergeLLMConfig(base.llm, update.llm, update.llmProvider),
    persistence: {
      jobStore: update.jobStore ?? base.persistence?.jobStore,
    },
    pipeline: {
      maxStageRetries: update.maxStageRetries ?? base.pipeline?.maxStageRetries,
      retryBackoffMs: update.retryBackoffMs ?? base.pipeline?.retryBackoffMs,
    },
    providerProfile: update.providerProfile ?? base.providerProfile,
    providers: {
      asr: update.asr ?? base.providers?.asr,
      tts: update.tts ?? base.providers?.tts,
      vlm: update.vlm ?? base.providers?.vlm,
    },
    providerSettings: mergeProviderSettings(base.providerSettings, update.providerSettings),
    version: 1,
  })
  const config = normalizeConfig(stored)

  await mkdir(dirname(path), {recursive: true})
  await bunWrite(path, `${JSON.stringify(stored, null, 2)}\n`)

  return {config, path}
}

async function readStoredConfig(workspaceDir: string): Promise<StoredAgentConfig> {
  const path = resolveConfigPath(workspaceDir)

  if (!await bunFile(path).exists()) {
    return {version: 1}
  }

  return bunFile(path).json<StoredAgentConfig>()
}

function normalizeConfig(config: StoredAgentConfig): AgentConfig {
  const profile = config.providerProfile === undefined ? undefined : getProviderProfile(config.providerProfile)
  const llm = mergeLLMConfig(profile?.llm, config.llm)

  return {
    ...(llm === undefined ? {} : {llm}),
    persistence: normalizePersistence(config),
    pipeline: normalizePipeline(config),
    ...(config.providerProfile === undefined ? {} : {providerProfile: config.providerProfile}),
    providers: normalizeProviders(config, profile),
    providerSettings: normalizeProviderSettings(mergeProviderSettings(profile?.providerSettings, config.providerSettings)),
    version: 1,
  }
}

function normalizePersistence(config: StoredAgentConfig): AgentConfig['persistence'] {
  return {
    jobStore: config.persistence?.jobStore ?? DEFAULT_AGENT_CONFIG.persistence.jobStore,
  }
}

function normalizePipeline(config: StoredAgentConfig): AgentConfig['pipeline'] {
  return {
    maxStageRetries: normalizeNonNegativeInteger(config.pipeline?.maxStageRetries, DEFAULT_AGENT_CONFIG.pipeline.maxStageRetries),
    retryBackoffMs: normalizeNonNegativeInteger(config.pipeline?.retryBackoffMs, DEFAULT_AGENT_CONFIG.pipeline.retryBackoffMs),
  }
}

function normalizeProviders(config: StoredAgentConfig, profile: ReturnType<typeof getProviderProfile>): AgentConfig['providers'] {
  return {
    asr: config.providers?.asr ?? profile?.providers.asr ?? DEFAULT_AGENT_CONFIG.providers.asr,
    tts: config.providers?.tts ?? profile?.providers.tts ?? DEFAULT_AGENT_CONFIG.providers.tts,
    vlm: config.providers?.vlm ?? profile?.providers.vlm ?? DEFAULT_AGENT_CONFIG.providers.vlm,
  }
}

function mergeLLMConfig(
  current: LLMClientConfig | undefined,
  update?: Partial<LLMClientConfig>,
  provider?: LLMProviderName,
): LLMClientConfig | undefined {
  if (current === undefined && update === undefined && provider === undefined) {
    return undefined
  }

  return normalizeLLMConfig({
    ...current,
    ...update,
    ...(provider === undefined ? {} : {provider}),
  })
}

function normalizeLLMConfig(value: Partial<LLMClientConfig> | undefined): LLMClientConfig | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value.provider !== 'anthropic' && value.provider !== 'openai-compatible') {
    throw new TypeError(`Unsupported LLM provider: ${String(value.provider)}`)
  }

  if (typeof value.model !== 'string' || value.model.trim() === '') {
    throw new TypeError('LLM model must be configured.')
  }

  if (value.provider === 'openai-compatible' && (typeof value.baseURL !== 'string' || value.baseURL.trim() === '')) {
    throw new TypeError('LLM baseURL must be configured for openai-compatible.')
  }

  return {
    ...(normalizeOptionalString(value.apiKeyEnv) === undefined ? {} : {apiKeyEnv: normalizeOptionalString(value.apiKeyEnv)}),
    ...(normalizeOptionalString(value.authTokenEnv) === undefined ? {} : {authTokenEnv: normalizeOptionalString(value.authTokenEnv)}),
    ...(normalizeOptionalString(value.baseURL) === undefined ? {} : {baseURL: normalizeOptionalString(value.baseURL)}),
    ...(value.headers === undefined ? {} : {headers: normalizeHeaders(value.headers)}),
    model: value.model.trim(),
    ...(normalizeOptionalString(value.name) === undefined ? {} : {name: normalizeOptionalString(value.name)}),
    provider: value.provider,
    ...(value.supportsStructuredOutputs === undefined ? {} : {supportsStructuredOutputs: value.supportsStructuredOutputs}),
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim()
}

function normalizeHeaders(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => entry[0].trim() !== '' && typeof entry[1] === 'string' && entry[1].trim() !== ''))
}

function compactStoredConfig(config: StoredAgentConfig): StoredAgentConfig {
  const normalized = normalizeConfig(config)
  const profile = normalized.providerProfile === undefined ? undefined : getProviderProfile(normalized.providerProfile)
  const baseProviders = {
    asr: profile?.providers.asr ?? DEFAULT_AGENT_CONFIG.providers.asr,
    tts: profile?.providers.tts ?? DEFAULT_AGENT_CONFIG.providers.tts,
    vlm: profile?.providers.vlm ?? DEFAULT_AGENT_CONFIG.providers.vlm,
  }
  const providerOverrides = Object.fromEntries(
    Object.entries(normalized.providers).filter(([role, provider]) => provider !== baseProviders[role as keyof typeof baseProviders]),
  ) as StoredAgentConfig['providers']
  const providerSettings = diffProviderSettings(normalized.providerSettings, profile?.providerSettings ?? {})

  return {
    ...(normalized.llm === undefined || deepEqual(normalized.llm, profile?.llm) ? {} : {llm: normalized.llm}),
    ...(normalized.persistence.jobStore === DEFAULT_AGENT_CONFIG.persistence.jobStore ? {} : {persistence: normalized.persistence}),
    ...(normalized.pipeline.maxStageRetries === DEFAULT_AGENT_CONFIG.pipeline.maxStageRetries && normalized.pipeline.retryBackoffMs === DEFAULT_AGENT_CONFIG.pipeline.retryBackoffMs ? {} : {pipeline: normalized.pipeline}),
    ...(normalized.providerProfile === undefined ? {} : {providerProfile: normalized.providerProfile}),
    ...(Object.keys(providerSettings).length === 0 ? {} : {providerSettings}),
    ...(providerOverrides === undefined || Object.keys(providerOverrides).length === 0 ? {} : {providers: providerOverrides}),
    version: 1,
  }
}

function mergeProviderSettings(...values: Array<ProviderSettings | undefined>): ProviderSettings {
  const merged: ProviderSettings = {}

  for (const value of values) {
    for (const [role, settings] of Object.entries(value ?? {})) {
      merged[role as keyof ProviderSettings] = {
        ...merged[role as keyof ProviderSettings],
        ...settings,
      }
    }
  }

  return merged
}

function normalizeProviderSettings(value: ProviderSettings): ProviderSettings {
  const normalized: ProviderSettings = {}

  for (const [role, settings] of Object.entries(value)) {
    const normalizedSettings = {
      ...(Array.isArray(settings?.command) && settings.command.length > 0 ? {command: settings.command.filter((part) => typeof part === 'string' && part.trim() !== '')} : {}),
    }

    if (Object.keys(normalizedSettings).length > 0) {
      normalized[role as keyof ProviderSettings] = normalizedSettings
    }
  }

  return normalized
}

function diffProviderSettings(value: ProviderSettings, base: ProviderSettings): ProviderSettings {
  const diff: ProviderSettings = {}

  for (const [role, settings] of Object.entries(value)) {
    if (!deepEqual(settings, base[role as keyof ProviderSettings])) {
      diff[role as keyof ProviderSettings] = settings
    }
  }

  return diff
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`Expected non-negative integer config value, received: ${value}`)
  }

  return value
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
