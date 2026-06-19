import {getProviderDescriptor, MIMO_PROVIDER_MODEL_IDS, PROVIDER_ROLES, providerEnvName, type ProviderRole} from '@video-agent/providers'

import {bunEnv} from './bun-runtime.js'
import {type AgentConfig, readConfig} from './config.js'
import type {HealthCheck} from './doctor-types.js'
import {readRuntimeEnv} from './env.js'
import {createProviderEnv} from './provider-settings.js'

export async function checkProviderConfig(workspaceDir: string, env: Record<string, string | undefined> | undefined): Promise<HealthCheck[]> {
  try {
    const config = await readConfig(workspaceDir)
    const providerEnv = createProviderEnv(config, env ?? await readRuntimeEnv(workspaceDir))

    return PROVIDER_ROLES.map((role) => checkProviderRole(role, config, providerEnv))
  } catch (error) {
    return [
      {
        message: error instanceof Error ? error.message : String(error),
        name: 'provider:config',
        status: 'fail',
      },
    ]
  }
}

function checkProviderRole(role: ProviderRole, config: AgentConfig, env: Record<string, string | undefined> | undefined): HealthCheck {
  const provider = config.providers[role]
  const descriptor = getProviderDescriptor(provider)

  if (descriptor === undefined) {
    return {
      details: {provider},
      message: `Unsupported ${role} provider: ${provider}`,
      name: `provider:${role}`,
      status: 'fail',
    }
  }

  if (provider === 'mock') {
    return {
      details: {provider},
      message: `${role} provider is mock`,
      name: `provider:${role}`,
      status: 'pass',
    }
  }

  if (provider === 'command') {
    return checkCommandProvider(role, env)
  }

  if (provider === 'llm') {
    return checkLLMProvider(role, config, env)
  }

  return checkUnsupportedConfiguredProvider(role, provider)
}

function checkLLMProvider(role: ProviderRole, config: AgentConfig, env: Record<string, string | undefined> = bunEnv()): HealthCheck {
  if (config.llm === undefined) {
    return {
      details: {provider: 'llm'},
      message: `${role} provider is llm, but llm is not configured`,
      name: `provider:${role}`,
      status: 'fail',
    }
  }

  if (config.llm.name === 'mimo') {
    const authEnvs = createMimoAuthEnvCandidates(config)

    if (authEnvs.some((name) => env[name] !== undefined && env[name]?.trim() !== '')) {
      return {
        details: {env: authEnvs, model: resolveMimoRoleModel(role, config), provider: 'llm'},
        message: `${role} provider uses configured Mimo profile`,
        name: `provider:${role}`,
        status: 'pass',
      }
    }

    return {
      details: {env: authEnvs, model: resolveMimoRoleModel(role, config), provider: 'llm'},
      message: `${authEnvs.join(' or ')} is required for Mimo profile`,
      name: `provider:${role}`,
      status: 'fail',
    }
  }

  const authEnv = config.llm.authTokenEnv ?? config.llm.apiKeyEnv ?? (config.llm.provider === 'openai-compatible' ? 'VIDEO_AGENT_LLM_TOKEN' : undefined)

  if (authEnv === undefined) {
    return {
      details: {model: config.llm.model, provider: 'llm'},
      message: `${role} provider uses configured LLM`,
      name: `provider:${role}`,
      status: 'pass',
    }
  }

  if (env[authEnv] === undefined || env[authEnv]?.trim() === '') {
    return {
      details: {env: authEnv, model: config.llm.model, provider: 'llm'},
      message: `${authEnv} is required for llm provider`,
      name: `provider:${role}`,
      status: 'fail',
    }
  }

  return {
    details: {env: authEnv, model: config.llm.model, provider: 'llm'},
    message: `${role} provider uses configured LLM`,
    name: `provider:${role}`,
    status: 'pass',
  }
}

function createMimoAuthEnvCandidates(config: AgentConfig): string[] {
  return [
    config.llm?.apiKeyEnv,
    config.llm?.authTokenEnv,
    'MIMO_API_KEY',
    'VIDEO_AGENT_LLM_TOKEN',
  ].filter((name, index, names): name is string => typeof name === 'string' && name.trim() !== '' && names.indexOf(name) === index)
}

function resolveMimoRoleModel(role: ProviderRole, config: AgentConfig): string {
  if (role === 'asr') {
    return MIMO_PROVIDER_MODEL_IDS.asr
  }

  if (role === 'tts') {
    return MIMO_PROVIDER_MODEL_IDS.tts
  }

  return config.llm?.model ?? MIMO_PROVIDER_MODEL_IDS.llm
}

function checkCommandProvider(role: ProviderRole, env: Record<string, string | undefined> = bunEnv()): HealthCheck {
  const envName = providerEnvName(role, 'COMMAND')
  const value = env[envName]

  if (value === undefined || value.trim() === '') {
    return {
      details: {env: envName, provider: 'command'},
      message: `${envName} is required for command provider`,
      name: `provider:${role}`,
      status: 'fail',
    }
  }

  try {
    const parsed = JSON.parse(value) as unknown

    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== 'string' || part.length === 0)) {
      return {
        details: {env: envName, provider: 'command'},
        message: `${envName} must be a non-empty JSON array of strings`,
        name: `provider:${role}`,
        status: 'fail',
      }
    }

    return {
      details: {command: parsed, env: envName, provider: 'command'},
      message: `${envName} is configured`,
      name: `provider:${role}`,
      status: 'pass',
    }
  } catch (error) {
    return {
      details: {env: envName, provider: 'command'},
      message: `${envName} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      name: `provider:${role}`,
      status: 'fail',
    }
  }
}

function checkUnsupportedConfiguredProvider(role: ProviderRole, provider: string): HealthCheck {
  return {
    details: {provider},
    message: `Unsupported ${role} provider: ${provider}`,
    name: `provider:${role}`,
    status: 'fail',
  }
}
