import type {LLMClientConfig} from '@video-agent/llm'

import type {ProviderRole} from './descriptors.js'

export const PROVIDER_PROFILE_NAMES = ['mimo'] as const

export type ProviderProfileName = typeof PROVIDER_PROFILE_NAMES[number]

export interface ProviderProfile {
  description: string
  llm?: LLMClientConfig
  models: ProviderProfileModel[]
  name: ProviderProfileName
  providers: {
    asr: string
    tts: string
    vlm: string
  }
  providerSettings: ProviderSettings
}

export interface ProviderProfileModel {
  id: string
  roles: Array<'asr' | 'tts' | 'vlm'>
}

export type ProviderSettings = Partial<Record<ProviderRole, ProviderRoleSettings>>

export interface ProviderRoleSettings {
  command?: string[]
  model?: string
  timeoutMs?: number
  url?: string
}

export const MIMO_PROVIDER_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/anthropic'

export const MIMO_PROVIDER_MODELS: ProviderProfileModel[] = [
  {
    id: 'mimo-v2.5-pro',
    roles: ['vlm'],
  },
  {
    id: 'mimo-v2.5',
    roles: ['vlm'],
  },
  {
    id: 'mimo-v2.5-asr',
    roles: ['asr'],
  },
  {
    id: 'mimo-v2.5-tts-voiceclone',
    roles: ['tts'],
  },
  {
    id: 'mimo-v2.5-tts-voicedesign',
    roles: ['tts'],
  },
  {
    id: 'mimo-v2.5-tts',
    roles: ['tts'],
  },
  {
    id: 'mimo-v2-pro',
    roles: ['vlm'],
  },
  {
    id: 'mimo-v2-omni',
    roles: ['vlm'],
  },
  {
    id: 'mimo-v2-tts',
    roles: ['tts'],
  },
]

export const MIMO_PROVIDER_PROFILE: ProviderProfile = {
  description: 'Mimo hosted provider profile using the Anthropic-compatible endpoint.',
  llm: {
    authTokenEnv: 'VIDEO_AGENT_LLM_TOKEN',
    baseURL: MIMO_PROVIDER_BASE_URL,
    model: 'mimo-v2.5-pro',
    name: 'mimo',
    provider: 'anthropic',
  },
  models: MIMO_PROVIDER_MODELS,
  name: 'mimo',
  providers: {
    asr: 'http',
    tts: 'http',
    vlm: 'http',
  },
  providerSettings: {
    asr: {
      model: 'mimo-v2.5-asr',
      timeoutMs: 120_000,
      url: MIMO_PROVIDER_BASE_URL,
    },
    tts: {
      model: 'mimo-v2.5-tts',
      timeoutMs: 120_000,
      url: MIMO_PROVIDER_BASE_URL,
    },
    vlm: {
      model: 'mimo-v2.5-pro',
      timeoutMs: 120_000,
      url: MIMO_PROVIDER_BASE_URL,
    },
  },
}

export const PROVIDER_PROFILES: Record<ProviderProfileName, ProviderProfile> = {
  mimo: MIMO_PROVIDER_PROFILE,
}

export function getProviderProfile(name: string): ProviderProfile | undefined {
  return isProviderProfileName(name) ? PROVIDER_PROFILES[name] : undefined
}

export function isProviderProfileName(name: string): name is ProviderProfileName {
  return (PROVIDER_PROFILE_NAMES as readonly string[]).includes(name)
}
