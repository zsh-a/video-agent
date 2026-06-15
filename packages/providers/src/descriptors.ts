export const PROVIDER_ROLES = ['asr', 'vlm', 'tts'] as const
export const BUILTIN_PROVIDER_NAMES = ['command', 'http', 'mock'] as const

export type ProviderName = typeof BUILTIN_PROVIDER_NAMES[number]
export type ProviderRole = typeof PROVIDER_ROLES[number]
export type ProviderRequirementKind = 'commandArgvJson' | 'customHeadersJson' | 'httpUrl' | 'timeoutMs' | 'token'

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
  http: {
    description: 'Hosted or local HTTP JSON adapter.',
    name: 'http',
    requirements: (role) => [
      {
        description: `${role.toUpperCase()} HTTP adapter endpoint.`,
        env: providerEnvName(role, 'URL'),
        kind: 'httpUrl',
        placeholder: `https://provider.example/${role}`,
        required: true,
        secret: false,
      },
      {
        description: `${role.toUpperCase()} bearer token for HTTP adapter requests.`,
        env: providerEnvName(role, 'TOKEN'),
        kind: 'token',
        placeholder: '<token>',
        required: false,
        secret: true,
      },
      {
        description: `${role.toUpperCase()} HTTP adapter custom headers as a JSON object of string values.`,
        env: providerEnvName(role, 'HEADERS'),
        kind: 'customHeadersJson',
        placeholder: '{"x-api-key":"<token>"}',
        required: false,
        secret: true,
      },
      {
        description: `${role.toUpperCase()} HTTP adapter timeout in milliseconds.`,
        env: providerEnvName(role, 'TIMEOUT_MS'),
        kind: 'timeoutMs',
        placeholder: '60000',
        required: false,
        secret: false,
      },
    ],
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
