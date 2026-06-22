import {getProviderEnvironmentDefinitions, PROVIDER_ROLES, type ProviderName, type ProviderRole} from '@video-agent/providers'

import type {AgentConfig} from '../shared/config.js'

import {readConfig} from '../shared/config.js'
import {readRuntimeEnv} from '../shared/env.js'
import {createProviderEnv} from './settings.js'

import {DEFAULT_WORKSPACE_DIR} from '../shared/defaults.js'
export interface ProviderEnvironmentReport {
  providers: ProviderEnvironmentRoleReport[]
  summary: ProviderEnvironmentSummary
  workspaceDir: string
}

export interface ProviderEnvironmentRoleReport {
  provider: ProviderName
  requirements: ProviderEnvironmentRequirement[]
  role: ProviderRole
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

export async function readProviderEnvironment(workspaceDir = DEFAULT_WORKSPACE_DIR, env?: Record<string, string | undefined>): Promise<ProviderEnvironmentReport> {
  const config = await readConfig(workspaceDir)
  const providerEnv = createProviderEnv(config, env ?? await readRuntimeEnv(workspaceDir))
  const providers = PROVIDER_ROLES.map((role) => createProviderEnvironmentRoleReport(role, config, providerEnv))

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

function createProviderRequirements(role: ProviderRole, provider: ProviderName, env: Record<string, string | undefined>): ProviderEnvironmentRequirement[] {
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
  const definition = getProviderEnvironmentDefinitions(provider.role, provider.provider).find((item) => item.env === requirement.env)

  if (definition === undefined) {
    throw new Error(`Provider ${provider.role}:${provider.provider} has no environment definition for ${requirement.env}.`)
  }

  return definition.placeholder
}
