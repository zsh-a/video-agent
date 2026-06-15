export const PROVIDER_ROLES = ['asr', 'vlm', 'tts'] as const
export const BUILTIN_PROVIDER_NAMES = ['command', 'llm', 'mock'] as const

export type ProviderName = typeof BUILTIN_PROVIDER_NAMES[number]
export type ProviderRole = typeof PROVIDER_ROLES[number]
export type ProviderRequirementKind = 'commandArgvJson'

export interface ProviderEnvironmentDefinition {
  description: string
  env: string
  kind: ProviderRequirementKind
  placeholder: string
  required: boolean
  secret: boolean
}

export interface ProviderDescriptor {
  description: string
  name: ProviderName
  requirements(role: ProviderRole): ProviderEnvironmentDefinition[]
}

export const PROVIDER_DESCRIPTORS: Record<ProviderName, ProviderDescriptor> = {
  command: {
    description: 'External process adapter over JSON stdin/stdout.',
    name: 'command',
    requirements: (role) => [
      {
        description: `${role.toUpperCase()} command adapter argv as a JSON string array.`,
        env: providerEnvName(role, 'COMMAND'),
        kind: 'commandArgvJson',
        placeholder: '["node","./providers/adapter.js"]',
        required: true,
        secret: false,
      },
    ],
  },
  llm: {
    description: 'Configured LLM client for structured ASR/VLM/TTS outputs.',
    name: 'llm',
    requirements: () => [],
  },
  mock: {
    description: 'Deterministic local development provider.',
    name: 'mock',
    requirements: () => [],
  },
}

export function getProviderDescriptor(name: string): ProviderDescriptor | undefined {
  return isProviderName(name) ? PROVIDER_DESCRIPTORS[name] : undefined
}

export function getProviderEnvironmentDefinitions(role: ProviderRole, provider: string): ProviderEnvironmentDefinition[] {
  return getProviderDescriptor(provider)?.requirements(role) ?? []
}

export function isProviderName(name: string): name is ProviderName {
  return (BUILTIN_PROVIDER_NAMES as readonly string[]).includes(name)
}

export function providerEnvName(role: ProviderRole, suffix: string): string {
  return `VIDEO_AGENT_${role.toUpperCase()}_${suffix}`
}
