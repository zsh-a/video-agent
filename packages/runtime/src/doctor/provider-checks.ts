import {DEFAULT_LLM_API_KEY_ENV, createMimoApiKeyEnvCandidates} from '@video-agent/llm'
import {MIMO_PROVIDER_MODEL_IDS, PROVIDER_ROLES, parseCommandArgvJson, providerEnvName, type ProviderRole} from '@video-agent/providers'

import {bunEnv} from '../shared/bun-runtime.js'
import {type AgentConfig, readConfig} from '../shared/config.js'
import type {HealthCheck} from './types.js'
import {readRuntimeEnv} from '../shared/env.js'
import {createProviderEnv} from '../provider/settings.js'

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

  return throwUnsupportedProvider(role, provider)
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

  const authEnv = config.llm.apiKeyEnv ?? DEFAULT_LLM_API_KEY_ENV

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
  return createMimoApiKeyEnvCandidates(config.llm)
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
    const command = parseCommandArgvJson(value, {source: envName})

    return {
      details: {command, env: envName, provider: 'command'},
      message: `${envName} is configured`,
      name: `provider:${role}`,
      status: 'pass',
    }
  } catch (error) {
    return {
      details: {env: envName, provider: 'command'},
      message: error instanceof Error ? error.message : String(error),
      name: `provider:${role}`,
      status: 'fail',
    }
  }
}

function throwUnsupportedProvider(role: ProviderRole, provider: never): never {
  throw new TypeError(`Unsupported ${role} provider: ${String(provider)}`)
}
