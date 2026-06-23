import type {LLMClientConfig, LLMProviderName} from '@video-agent/llm'

import {OPENAI_COMPATIBLE_LLM_PROVIDER, isLLMProviderName} from '@video-agent/llm'
import {PROVIDER_ROLES, getProviderProfile, isProviderName, isProviderProfileName, type ProviderName, type ProviderProfileName, type ProviderRole, type ProviderRoleSettings, type ProviderSettings} from '@video-agent/providers'
import {mkdir, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {z} from 'zod'

import {JsonFileParseError, readOptionalJson} from './file-io.js'

import {DEFAULT_WORKSPACE_DIR} from './defaults.js'
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
  providers: Record<ProviderRole, ProviderName>
  providerSettings: ProviderSettings
  version: 1
}

export const JOB_STORE_KINDS = ['json', 'sqlite'] as const

export type JobStoreKind = (typeof JOB_STORE_KINDS)[number]

export const DEFAULT_JOB_STORE_KIND = 'json' satisfies JobStoreKind

export interface ConfigUpdate {
  asr?: ProviderName
  jobStore?: JobStoreKind
  llm?: null | Partial<LLMClientConfig>
  llmProvider?: LLMProviderName
  maxStageRetries?: number
  providerProfile?: ProviderProfileName
  providerSettings?: ProviderSettings
  retryBackoffMs?: number
  tts?: ProviderName
  vlm?: ProviderName
}

const StoredLLMConfigSchema = z.object({
  apiKeyEnv: z.string().optional(),
  baseURL: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  model: z.string().optional(),
  name: z.string().optional(),
  provider: z.string().optional(),
  supportsStructuredOutputs: z.boolean().optional(),
}).passthrough()

const StoredAgentConfigSchema = z.object({
  llm: StoredLLMConfigSchema.optional(),
  persistence: z.object({
    jobStore: z.string().optional(),
  }).strict().optional(),
  pipeline: z.object({
    maxStageRetries: z.number().optional(),
    retryBackoffMs: z.number().optional(),
  }).strict().optional(),
  providerProfile: z.string().optional(),
  providers: z.object({
    asr: z.string().optional(),
    tts: z.string().optional(),
    vlm: z.string().optional(),
  }).strict().optional(),
  providerSettings: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  version: z.unknown().optional(),
}).strict()

interface ParsedStoredLLMConfig {
  [key: string]: unknown
  apiKeyEnv?: string
  baseURL?: string
  headers?: Record<string, string>
  model?: string
  name?: string
  provider?: string
  supportsStructuredOutputs?: boolean
}

type StoredLLMConfig = Partial<LLMClientConfig> | ParsedStoredLLMConfig

interface StoredAgentConfig {
  llm?: StoredLLMConfig
  persistence?: {
    jobStore?: string
  }
  pipeline?: {
    maxStageRetries?: number
    retryBackoffMs?: number
  }
  providerProfile?: string
  providers?: {
    asr?: string
    tts?: string
    vlm?: string
  }
  providerSettings?: StoredProviderSettings
  version?: unknown
}

type StoredProviderSettings = Record<string, ProviderRoleSettings | Record<string, unknown> | undefined>

const DEFAULT_PERSISTENCE_CONFIG: AgentConfig['persistence'] = {
  jobStore: DEFAULT_JOB_STORE_KIND,
}

const DEFAULT_PIPELINE_CONFIG: AgentConfig['pipeline'] = {
  maxStageRetries: 0,
  retryBackoffMs: 0,
}

const INITIAL_PROVIDER_CONFIG: AgentConfig['providers'] = {
  asr: 'mock',
  tts: 'mock',
  vlm: 'mock',
}

export function resolveConfigPath(workspaceDir = DEFAULT_WORKSPACE_DIR): string {
  return resolve(workspaceDir, 'config.json')
}

export async function readConfig(workspaceDir = DEFAULT_WORKSPACE_DIR): Promise<AgentConfig> {
  const path = resolveConfigPath(workspaceDir)
  const value = await readConfigJson(path)

  if (value === undefined) {
    throw new Error(`Config file not found: ${path}. Run "bun run dev init --workspace ${workspaceDir}" before runtime commands.`)
  }

  return normalizeConfig(parseStoredConfig(value))
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
  await writeFile(path, `${JSON.stringify(stored, null, 2)}\n`)

  return {config, path}
}

async function readStoredConfig(workspaceDir: string): Promise<StoredAgentConfig> {
  const path = resolveConfigPath(workspaceDir)
  const value = await readConfigJson(path)

  if (value === undefined) {
    return createDefaultStoredConfig()
  }

  return parseStoredConfig(value)
}

async function readConfigJson(path: string): Promise<unknown | undefined> {
  try {
    return await readOptionalJson(path)
  } catch (error) {
    if (error instanceof JsonFileParseError) {
      throw new Error(`Config file ${path} is invalid JSON; no config parse fallback is allowed. ${error.details.issues}`)
    }

    throw error
  }
}

function createDefaultStoredConfig(): StoredAgentConfig {
  return {
    providers: {
      ...INITIAL_PROVIDER_CONFIG,
    },
    version: 1,
  }
}

function normalizeConfig(config: StoredAgentConfig): AgentConfig {
  normalizeVersion(config.version)

  const providerProfile = normalizeProviderProfile(config.providerProfile)
  const profile = providerProfile === undefined ? undefined : getProviderProfile(providerProfile)
  const llm = mergeLLMConfig(profile?.llm, config.llm)

  return {
    ...(llm === undefined ? {} : {llm}),
    persistence: normalizePersistence(config),
    pipeline: normalizePipeline(config),
    ...(providerProfile === undefined ? {} : {providerProfile}),
    providers: normalizeProviders(config, profile),
    providerSettings: normalizeProviderSettings(mergeProviderSettings(profile?.providerSettings, config.providerSettings)),
    version: 1,
  }
}

function normalizePersistence(config: StoredAgentConfig): AgentConfig['persistence'] {
  return {
    jobStore: normalizeJobStoreKind(config.persistence?.jobStore),
  }
}

function normalizeJobStoreKind(value: string | undefined): JobStoreKind {
  if (value === undefined) {
    return DEFAULT_PERSISTENCE_CONFIG.jobStore
  }

  if (JOB_STORE_KINDS.includes(value as JobStoreKind)) {
    return value as JobStoreKind
  }

  throw new TypeError(`Unsupported job store: ${value}`)
}

function normalizePipeline(config: StoredAgentConfig): AgentConfig['pipeline'] {
  return {
    maxStageRetries: normalizeNonNegativeInteger(config.pipeline?.maxStageRetries, DEFAULT_PIPELINE_CONFIG.maxStageRetries),
    retryBackoffMs: normalizeNonNegativeInteger(config.pipeline?.retryBackoffMs, DEFAULT_PIPELINE_CONFIG.retryBackoffMs),
  }
}

function normalizeProviders(config: StoredAgentConfig, profile: ReturnType<typeof getProviderProfile>): AgentConfig['providers'] {
  return {
    asr: normalizeProviderName('asr', resolveConfiguredProvider('asr', config, profile)),
    tts: normalizeProviderName('tts', resolveConfiguredProvider('tts', config, profile)),
    vlm: normalizeProviderName('vlm', resolveConfiguredProvider('vlm', config, profile)),
  }
}

function resolveConfiguredProvider(role: keyof AgentConfig['providers'], config: StoredAgentConfig, profile: ReturnType<typeof getProviderProfile>): string {
  const provider = config.providers?.[role] ?? profile?.providers[role]

  if (provider === undefined) {
    throw new TypeError(`Provider ${role} must be configured in providers or providerProfile.`)
  }

  return provider
}

function normalizeProviderName(role: keyof AgentConfig['providers'], provider: string): ProviderName {
  if (isProviderName(provider)) {
    return provider
  }

  throw new TypeError(`Unsupported ${role} provider: ${provider}`)
}

function normalizeProviderProfile(profile: string | undefined): ProviderProfileName | undefined {
  if (profile === undefined) {
    return undefined
  }

  if (isProviderProfileName(profile)) {
    return profile
  }

  throw new TypeError(`Unsupported provider profile: ${profile}`)
}

function normalizeVersion(version: unknown): 1 {
  if (version === 1) {
    return version
  }

  throw new TypeError(`Unsupported config version: ${String(version)}`)
}

function parseStoredConfig(value: unknown): StoredAgentConfig {
  const result = StoredAgentConfigSchema.safeParse(value)

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`).join('; ')

    throw new TypeError(`Config file config.json has invalid shape; no config shape inference fallback is allowed. ${issues}`)
  }

  return result.data
}

function mergeLLMConfig(
  current: LLMClientConfig | StoredLLMConfig | undefined,
  update?: Partial<LLMClientConfig> | StoredLLMConfig,
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

function normalizeLLMConfig(value: Partial<LLMClientConfig> | StoredLLMConfig | undefined): LLMClientConfig | undefined {
  if (value === undefined) {
    return undefined
  }

  const unsupportedKey = Object.keys(value).find((key) => !['apiKeyEnv', 'baseURL', 'headers', 'model', 'name', 'provider', 'supportsStructuredOutputs'].includes(key))

  if (unsupportedKey !== undefined) {
    throw new TypeError(`Unsupported LLM config field: ${unsupportedKey}`)
  }

  const provider = value.provider

  if (!isLLMProviderName(provider)) {
    throw new TypeError(`Unsupported LLM provider: ${String(provider)}`)
  }

  const model = normalizeRequiredCleanString(value.model, 'LLM model')
  const baseURL = normalizeOptionalString(value.baseURL, 'LLM baseURL')
  const apiKeyEnv = normalizeOptionalString(value.apiKeyEnv, 'LLM apiKeyEnv')
  const name = normalizeOptionalString(value.name, 'LLM name')
  const supportsStructuredOutputs = normalizeOptionalBoolean(value.supportsStructuredOutputs, 'LLM supportsStructuredOutputs')

  if (provider === OPENAI_COMPATIBLE_LLM_PROVIDER && baseURL === undefined) {
    throw new TypeError(`LLM baseURL must be configured for ${OPENAI_COMPATIBLE_LLM_PROVIDER}.`)
  }

  if (provider !== OPENAI_COMPATIBLE_LLM_PROVIDER && supportsStructuredOutputs !== undefined) {
    throw new TypeError(`LLM supportsStructuredOutputs is only supported for ${OPENAI_COMPATIBLE_LLM_PROVIDER}.`)
  }

  return {
    ...(apiKeyEnv === undefined ? {} : {apiKeyEnv}),
    ...(baseURL === undefined ? {} : {baseURL}),
    ...(value.headers === undefined ? {} : {headers: normalizeHeaders(value.headers)}),
    model,
    ...(name === undefined ? {} : {name}),
    provider,
    ...(supportsStructuredOutputs === undefined ? {} : {supportsStructuredOutputs}),
  }
}

function normalizeOptionalBoolean(value: boolean | undefined, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new TypeError(`${field} must be a boolean.`)
  }

  return value
}

function normalizeOptionalString(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return normalizeRequiredCleanString(value, field)
}

function normalizeRequiredCleanString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) {
    throw new TypeError(`${field} must be clean non-empty text; no config string cleanup fallback is allowed.`)
  }

  return value
}

function normalizeHeaders(value: Record<string, string>): Record<string, string> {
  for (const [key, headerValue] of Object.entries(value)) {
    if (key === '' || key.trim() !== key || typeof headerValue !== 'string' || headerValue === '' || headerValue.trim() !== headerValue) {
      throw new TypeError('LLM headers must use clean non-empty string keys and values; no config header cleanup fallback is allowed.')
    }
  }

  return value
}

function compactStoredConfig(config: StoredAgentConfig): StoredAgentConfig {
  const normalized = normalizeConfig(config)
  const profile = normalized.providerProfile === undefined ? undefined : getProviderProfile(normalized.providerProfile)
  const providers = normalized.providerProfile === undefined
    ? normalized.providers
    : diffProviders(normalized.providers, profile?.providers)
  const providerSettings = diffProviderSettings(normalized.providerSettings, profile?.providerSettings ?? {})

  return {
    ...(normalized.llm === undefined || deepEqual(normalized.llm, profile?.llm) ? {} : {llm: normalized.llm}),
    ...(normalized.persistence.jobStore === DEFAULT_PERSISTENCE_CONFIG.jobStore ? {} : {persistence: normalized.persistence}),
    ...(normalized.pipeline.maxStageRetries === DEFAULT_PIPELINE_CONFIG.maxStageRetries && normalized.pipeline.retryBackoffMs === DEFAULT_PIPELINE_CONFIG.retryBackoffMs ? {} : {pipeline: normalized.pipeline}),
    ...(normalized.providerProfile === undefined ? {} : {providerProfile: normalized.providerProfile}),
    ...(Object.keys(providerSettings).length === 0 ? {} : {providerSettings}),
    ...(Object.keys(providers).length === 0 ? {} : {providers}),
    version: 1,
  }
}

function diffProviders(value: AgentConfig['providers'], base: AgentConfig['providers'] | undefined): NonNullable<StoredAgentConfig['providers']> {
  const diff: NonNullable<StoredAgentConfig['providers']> = {}

  for (const role of PROVIDER_ROLES) {
    if (value[role] !== base?.[role]) {
      diff[role] = value[role]
    }
  }

  return diff
}

function mergeProviderSettings(...values: Array<ProviderSettings | StoredProviderSettings | undefined>): StoredProviderSettings {
  const merged: StoredProviderSettings = {}

  for (const value of values) {
    for (const [role, settings] of Object.entries(value ?? {})) {
      merged[role] = {
        ...merged[role],
        ...settings,
      }
    }
  }

  return merged
}

function normalizeProviderSettings(value: StoredProviderSettings): ProviderSettings {
  const normalized: ProviderSettings = {}

  for (const [role, settings] of Object.entries(value)) {
    if (!isProviderRole(role)) {
      throw new TypeError(`Unsupported provider settings role: ${role}`)
    }

    const normalizedSettings = normalizeProviderRoleSettings(role, settings)

    if (Object.keys(normalizedSettings).length > 0) {
      normalized[role] = normalizedSettings
    }
  }

  return normalized
}

function isProviderRole(role: string): role is ProviderRole {
  return (PROVIDER_ROLES as readonly string[]).includes(role)
}

function normalizeProviderRoleSettings(role: ProviderRole, settings: ProviderRoleSettings | undefined): ProviderRoleSettings {
  if (settings === undefined) {
    return {}
  }

  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    throw new TypeError(`Provider settings for ${role} must be an object.`)
  }

  const unsupportedKey = Object.keys(settings).find((key) => key !== 'command')

  if (unsupportedKey !== undefined) {
    throw new TypeError(`Unsupported provider settings field for ${role}: ${unsupportedKey}`)
  }

  if (settings.command === undefined) {
    return {}
  }

  if (!Array.isArray(settings.command) || settings.command.length === 0) {
    throw new TypeError(`Provider settings command for ${role} must be a non-empty string array.`)
  }

  if (settings.command.some((part) => typeof part !== 'string' || part === '' || part.trim() !== part)) {
    throw new TypeError(`Provider settings command for ${role} must contain only clean non-empty strings; no command argv cleanup fallback is allowed.`)
  }

  return {
    command: settings.command,
  }
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

function normalizeNonNegativeInteger(value: number | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`Expected non-negative integer config value, received: ${value}`)
  }

  return value
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
