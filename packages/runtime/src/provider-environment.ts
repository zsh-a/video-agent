import {getProviderEnvironmentDefinitions, PROVIDER_ROLES, type ProviderRole} from '@video-agent/providers'

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

export async function readProviderEnvironment(workspaceDir = '.video-agent', env: Record<string, string | undefined> = process.env): Promise<ProviderEnvironmentReport> {
  const config = await readConfig(workspaceDir)
  const providers = PROVIDER_ROLES.map((role) => createProviderEnvironmentRoleReport(role, config, mergeProviderEnv(config.providerEnv, env)))

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
        lines.push(`# optional: ${requirement.description}`, `# export ${requirement.env}='${placeholderForRequirement(provider, requirement)}'`)
        continue
      }

      lines.push(`export ${requirement.env}='${placeholderForRequirement(provider, requirement)}'`)
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
  return getProviderEnvironmentDefinitions(role, provider).map((definition) => createRequirement({
    description: definition.description,
    env,
    name: definition.env,
    required: definition.required,
  }))
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

function placeholderForRequirement(provider: ProviderEnvironmentRoleReport, requirement: ProviderEnvironmentRequirement): string {
  return getProviderEnvironmentDefinitions(provider.role, provider.provider).find((definition) => definition.env === requirement.env)?.placeholder ?? '<value>'
}

function mergeProviderEnv(configEnv: Record<string, string>, env: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    ...configEnv,
    ...env,
  }
}
