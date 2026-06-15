import {providerEnvName, type ProviderRole} from '@video-agent/providers'

import type {AgentConfig, ProviderSettings} from './config.js'

export function createProviderEnv(config: AgentConfig, env: Record<string, string | undefined> = getBunEnv()): Record<string, string | undefined> {
  return {
    ...providerSettingsToEnv(config.providerSettings),
    ...env,
  }
}

function getBunEnv(): Record<string, string | undefined> {
  const bun = (globalThis as typeof globalThis & {Bun?: {env: Record<string, string | undefined>}}).Bun

  if (bun === undefined) {
    throw new Error('Provider environment settings require Bun runtime.')
  }

  return bun.env
}

function providerSettingsToEnv(settings: ProviderSettings): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [role, roleSettings] of Object.entries(settings)) {
    const providerRole = role as ProviderRole

    if (roleSettings?.command !== undefined) {
      env[providerEnvName(providerRole, 'COMMAND')] = JSON.stringify(roleSettings.command)
    }
  }

  return env
}
