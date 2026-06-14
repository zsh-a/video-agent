import type {AgentConfig} from './config.js'

import {readConfig} from './config.js'

export interface ProviderEnvironmentReport {
  providers: ProviderEnvironmentRoleReport[]
  workspaceDir: string
}

export interface ProviderEnvironmentRoleReport {
  provider: string
  requirements: ProviderEnvironmentRequirement[]
  role: 'asr' | 'tts' | 'vlm'
}

export interface ProviderEnvironmentRequirement {
  configured: boolean
  description: string
  env: string
  required: boolean
}

type ProviderRole = ProviderEnvironmentRoleReport['role']

const PROVIDER_ROLES: readonly ProviderRole[] = ['asr', 'vlm', 'tts']

export async function readProviderEnvironment(workspaceDir = '.video-agent', env: Record<string, string | undefined> = process.env): Promise<ProviderEnvironmentReport> {
  const config = await readConfig(workspaceDir)

  return {
    providers: PROVIDER_ROLES.map((role) => createProviderEnvironmentRoleReport(role, config, env)),
    workspaceDir,
  }
}

function createProviderEnvironmentRoleReport(role: ProviderRole, config: AgentConfig, env: Record<string, string | undefined>): ProviderEnvironmentRoleReport {
  const provider = config.providers[role]

  return {
    provider,
    requirements: createProviderRequirements(role, provider, env),
    role,
  }
}

function createProviderRequirements(role: ProviderRole, provider: string, env: Record<string, string | undefined>): ProviderEnvironmentRequirement[] {
  if (provider === 'command') {
    return [
      createRequirement({
        description: `${role.toUpperCase()} command adapter argv as a JSON string array.`,
        env,
        name: `VIDEO_AGENT_${role.toUpperCase()}_COMMAND`,
        required: true,
      }),
    ]
  }

  if (provider === 'http') {
    return [
      createRequirement({
        description: `${role.toUpperCase()} HTTP adapter endpoint.`,
        env,
        name: `VIDEO_AGENT_${role.toUpperCase()}_URL`,
        required: true,
      }),
      createRequirement({
        description: `${role.toUpperCase()} bearer token for HTTP adapter requests.`,
        env,
        name: `VIDEO_AGENT_${role.toUpperCase()}_TOKEN`,
        required: false,
      }),
      createRequirement({
        description: `${role.toUpperCase()} HTTP adapter timeout in milliseconds.`,
        env,
        name: `VIDEO_AGENT_${role.toUpperCase()}_TIMEOUT_MS`,
        required: false,
      }),
    ]
  }

  return []
}

function createRequirement(options: {description: string; env: Record<string, string | undefined>; name: string; required: boolean}): ProviderEnvironmentRequirement {
  return {
    configured: isConfigured(options.env[options.name]),
    description: options.description,
    env: options.name,
    required: options.required,
  }
}

function isConfigured(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== ''
}
