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
  roles: Array<'llm'>
}

export type ProviderSettings = Partial<Record<ProviderRole, ProviderRoleSettings>>

export interface ProviderRoleSettings {
  command?: string[]
}

export const MIMO_PROVIDER_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1'

export const MIMO_PROVIDER_MODELS: ProviderProfileModel[] = [
  {
    id: 'mimo-v2.5-pro',
    roles: ['llm'],
  },
]

export const MIMO_PROVIDER_PROFILE: ProviderProfile = {
  description: 'Mimo hosted provider profile using the shared OpenAI-compatible endpoint.',
  llm: {
    apiKeyEnv: 'VIDEO_AGENT_LLM_TOKEN',
    baseURL: MIMO_PROVIDER_BASE_URL,
    model: 'mimo-v2.5-pro',
    name: 'mimo',
    provider: 'openai-compatible',
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
