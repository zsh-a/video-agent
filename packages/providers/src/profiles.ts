import {providerEnvName} from './descriptors.js'

export const PROVIDER_PROFILE_NAMES = ['mimo'] as const

export type ProviderProfileName = typeof PROVIDER_PROFILE_NAMES[number]

export interface ProviderProfile {
  description: string
  models: ProviderProfileModel[]
  name: ProviderProfileName
  providerEnv: Record<string, string>
  providers: {
    asr: string
    tts: string
    vlm: string
  }
}

export interface ProviderProfileModel {
  id: string
  roles: Array<'asr' | 'tts' | 'vlm'>
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
  models: MIMO_PROVIDER_MODELS,
  name: 'mimo',
  providerEnv: {
    [providerEnvName('asr', 'MODEL')]: 'mimo-v2.5-asr',
    [providerEnvName('asr', 'TIMEOUT_MS')]: '120000',
    [providerEnvName('asr', 'URL')]: MIMO_PROVIDER_BASE_URL,
    [providerEnvName('tts', 'MODEL')]: 'mimo-v2.5-tts',
    [providerEnvName('tts', 'TIMEOUT_MS')]: '120000',
    [providerEnvName('tts', 'URL')]: MIMO_PROVIDER_BASE_URL,
    [providerEnvName('vlm', 'MODEL')]: 'mimo-v2.5-pro',
    [providerEnvName('vlm', 'TIMEOUT_MS')]: '120000',
    [providerEnvName('vlm', 'URL')]: MIMO_PROVIDER_BASE_URL,
  },
  providers: {
    asr: 'http',
    tts: 'http',
    vlm: 'http',
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
