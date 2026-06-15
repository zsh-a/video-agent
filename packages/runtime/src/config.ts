import {getProviderProfile, type ProviderProfileName} from '@video-agent/providers'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

export interface AgentConfig {
  persistence: {
    jobStore: JobStoreKind
  }
  pipeline: {
    maxStageRetries: number
    retryBackoffMs: number
  }
  providerEnv: Record<string, string>
  providers: {
    asr: string
    tts: string
    vlm: string
  }
  version: 1
}

export type JobStoreKind = 'json' | 'sqlite'

export interface ConfigUpdate {
  asr?: string
  jobStore?: JobStoreKind
  maxStageRetries?: number
  providerEnv?: Record<string, string | undefined>
  providerProfile?: ProviderProfileName
  retryBackoffMs?: number
  tts?: string
  vlm?: string
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  persistence: {
    jobStore: 'json',
  },
  pipeline: {
    maxStageRetries: 0,
    retryBackoffMs: 0,
  },
  providerEnv: {},
  providers: {
    asr: 'mock',
    tts: 'mock',
    vlm: 'mock',
  },
  version: 1,
}

export function resolveConfigPath(workspaceDir = '.video-agent'): string {
  return resolve(workspaceDir, 'config.json')
}

export async function readConfig(workspaceDir = '.video-agent'): Promise<AgentConfig> {
  try {
    return normalizeConfig(JSON.parse(await readFile(resolveConfigPath(workspaceDir), 'utf8')) as Partial<AgentConfig>)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return DEFAULT_AGENT_CONFIG
    }

    throw error
  }
}

export async function writeConfig(workspaceDir: string, update: ConfigUpdate): Promise<{config: AgentConfig; path: string}> {
  const path = resolveConfigPath(workspaceDir)
  const current = await readConfig(workspaceDir)
  const profile = update.providerProfile === undefined ? undefined : getProviderProfile(update.providerProfile)
  const providerEnv = mergeProviderEnv(current.providerEnv, profile?.providerEnv, update.providerEnv)
  const config: AgentConfig = {
    ...current,
    persistence: {
      jobStore: update.jobStore ?? current.persistence.jobStore,
    },
    pipeline: {
      maxStageRetries: update.maxStageRetries === undefined ? current.pipeline.maxStageRetries : normalizeNonNegativeInteger(update.maxStageRetries, current.pipeline.maxStageRetries),
      retryBackoffMs: update.retryBackoffMs === undefined ? current.pipeline.retryBackoffMs : normalizeNonNegativeInteger(update.retryBackoffMs, current.pipeline.retryBackoffMs),
    },
    providerEnv,
    providers: {
      asr: update.asr ?? profile?.providers.asr ?? current.providers.asr,
      tts: update.tts ?? profile?.providers.tts ?? current.providers.tts,
      vlm: update.vlm ?? profile?.providers.vlm ?? current.providers.vlm,
    },
    version: 1,
  }

  await mkdir(dirname(path), {recursive: true})
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`)

  return {config, path}
}

function normalizeConfig(config: Partial<AgentConfig>): AgentConfig {
  return {
    persistence: {
      jobStore: config.persistence?.jobStore ?? DEFAULT_AGENT_CONFIG.persistence.jobStore,
    },
    pipeline: {
      maxStageRetries: normalizeNonNegativeInteger(config.pipeline?.maxStageRetries, DEFAULT_AGENT_CONFIG.pipeline.maxStageRetries),
      retryBackoffMs: normalizeNonNegativeInteger(config.pipeline?.retryBackoffMs, DEFAULT_AGENT_CONFIG.pipeline.retryBackoffMs),
    },
    providerEnv: normalizeProviderEnv(config.providerEnv),
    providers: {
      asr: config.providers?.asr ?? DEFAULT_AGENT_CONFIG.providers.asr,
      tts: config.providers?.tts ?? DEFAULT_AGENT_CONFIG.providers.tts,
      vlm: config.providers?.vlm ?? DEFAULT_AGENT_CONFIG.providers.vlm,
    },
    version: 1,
  }
}

function mergeProviderEnv(...values: Array<Record<string, string | undefined> | undefined>): Record<string, string> {
  const merged: Record<string, string> = {}

  for (const value of values) {
    for (const [key, envValue] of Object.entries(value ?? {})) {
      if (envValue === undefined || envValue.trim() === '') {
        delete merged[key]
        continue
      }

      merged[key] = envValue
    }
  }

  return merged
}

function normalizeProviderEnv(value: Record<string, unknown> | undefined): Record<string, string> {
  if (value === undefined) {
    return {}
  }

  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => entry[0].trim() !== '' && typeof entry[1] === 'string' && entry[1].trim() !== ''))
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
