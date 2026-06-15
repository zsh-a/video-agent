import type {AgentConfig} from './config.js'

import {readConfig} from './config.js'

export interface ProviderEnvironmentReport {
  providers: ProviderEnvironmentRoleReport[]
  summary: ProviderEnvironmentSummary
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

export interface ProviderEnvironmentSummary {
  configured: number
  missing: number
  missingRequired: string[]
  optional: number
  required: number
  total: number
}

export interface ProviderEnvironmentShellTemplateOptions {
  includeOptional?: boolean
}

type ProviderRole = ProviderEnvironmentRoleReport['role']

const PROVIDER_ROLES: readonly ProviderRole[] = ['asr', 'vlm', 'tts']

export async function readProviderEnvironment(workspaceDir = '.video-agent', env: Record<string, string | undefined> = process.env): Promise<ProviderEnvironmentReport> {
  const config = await readConfig(workspaceDir)
  const providers = PROVIDER_ROLES.map((role) => createProviderEnvironmentRoleReport(role, config, env))

  return {
    providers,
    summary: summarizeProviderEnvironment(providers),
    workspaceDir,
  }
}

export function createProviderEnvironmentShellTemplate(report: ProviderEnvironmentReport, options: ProviderEnvironmentShellTemplateOptions = {}): string {
  const lines = [
    '# video-agent provider environment template',
    `# workspace: ${report.workspaceDir}`,
  ]

  for (const provider of report.providers) {
    if (provider.requirements.length === 0) {
      continue
    }

    lines.push('', `# ${provider.role.toUpperCase()} ${provider.provider} provider`)

    for (const requirement of provider.requirements) {
      if (!requirement.required && options.includeOptional !== true) {
        lines.push(`# optional: ${requirement.description}`, `# export ${requirement.env}='${placeholderForRequirement(requirement)}'`)
        continue
      }

      lines.push(`export ${requirement.env}='${placeholderForRequirement(requirement)}'`)
    }
  }

  return `${lines.join('\n')}\n`
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
        description: `${role.toUpperCase()} HTTP adapter custom headers as a JSON object of string values.`,
        env,
        name: `VIDEO_AGENT_${role.toUpperCase()}_HEADERS`,
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

function summarizeProviderEnvironment(providers: ProviderEnvironmentRoleReport[]): ProviderEnvironmentSummary {
  const requirements = providers.flatMap((provider) => provider.requirements)
  const required = requirements.filter((requirement) => requirement.required)
  const configured = requirements.filter((requirement) => requirement.configured)
  const missing = requirements.filter((requirement) => !requirement.configured)

  return {
    configured: configured.length,
    missing: missing.length,
    missingRequired: required.filter((requirement) => !requirement.configured).map((requirement) => requirement.env),
    optional: requirements.length - required.length,
    required: required.length,
    total: requirements.length,
  }
}

function placeholderForRequirement(requirement: ProviderEnvironmentRequirement): string {
  if (requirement.env.endsWith('_COMMAND')) {
    return '["node","./providers/adapter.js"]'
  }

  if (requirement.env.endsWith('_URL')) {
    return `https://provider.example/${requirement.env.toLowerCase().replace(/^video_agent_/, '').replace(/_url$/, '')}`
  }

  if (requirement.env.endsWith('_TOKEN')) {
    return '<token>'
  }

  if (requirement.env.endsWith('_HEADERS')) {
    return '{"x-api-key":"<token>"}'
  }

  if (requirement.env.endsWith('_TIMEOUT_MS')) {
    return '60000'
  }

  return '<value>'
}
