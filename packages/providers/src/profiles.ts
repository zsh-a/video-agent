import {DEFAULT_LLM_API_KEY_ENV, OPENAI_COMPATIBLE_LLM_PROVIDER, type LLMClientConfig} from '@video-agent/llm'

import type {ProviderName, ProviderRole} from './descriptors.js'

export const PROVIDER_PROFILE_NAMES = ['mimo'] as const

export type ProviderProfileName = typeof PROVIDER_PROFILE_NAMES[number]

export interface ProviderProfile {
  description: string
  llm?: LLMClientConfig
  models: ProviderProfileModel[]
  name: ProviderProfileName
  providers: {
    asr: ProviderName
    tts: ProviderName
    vlm: ProviderName
  }
  providerSettings: ProviderSettings
}

export interface ProviderProfileModel {
  id: string
  roles: Array<'asr' | 'llm' | 'tts'>
}

export type ProviderSettings = Partial<Record<ProviderRole, ProviderRoleSettings>>

export interface ProviderRoleSettings {
  command?: string[]
}

export const MIMO_PROVIDER_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1'

export const MIMO_PROVIDER_MODEL_IDS = {
  asr: 'mimo-v2.5-asr',
  llm: 'mimo-v2.5',
  tts: 'mimo-v2.5-tts',
} as const

export const MIMO_PROVIDER_MODELS: ProviderProfileModel[] = [
  {
    id: MIMO_PROVIDER_MODEL_IDS.llm,
    roles: ['llm'],
  },
  {
    id: MIMO_PROVIDER_MODEL_IDS.asr,
    roles: ['asr'],
  },
  {
    id: MIMO_PROVIDER_MODEL_IDS.tts,
    roles: ['tts'],
  },
]

export const MIMO_PROVIDER_PROFILE: ProviderProfile = {
  description: 'Mimo hosted provider profile using the shared OpenAI-compatible endpoint.',
  llm: {
    apiKeyEnv: DEFAULT_LLM_API_KEY_ENV,
    baseURL: MIMO_PROVIDER_BASE_URL,
    model: MIMO_PROVIDER_MODEL_IDS.llm,
    name: 'mimo',
    provider: OPENAI_COMPATIBLE_LLM_PROVIDER,
    supportsStructuredOutputs: true,
  },
  models: MIMO_PROVIDER_MODELS,
  name: 'mimo',
  providers: {
    asr: 'llm',
    tts: 'llm',
    vlm: 'llm',
  },
  providerSettings: {},
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
