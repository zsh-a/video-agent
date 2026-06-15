import {providerEnvName, type ProviderRole} from '@video-agent/providers'

import type {AgentConfig, ProviderSettings} from './config.js'

export function createProviderEnv(config: AgentConfig, env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  return {
    ...providerSettingsToEnv(config.providerSettings),
    ...env,
  }
}

function providerSettingsToEnv(settings: ProviderSettings): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [role, roleSettings] of Object.entries(settings)) {
    const providerRole = role as ProviderRole

    if (roleSettings?.command !== undefined) {
      env[providerEnvName(providerRole, 'COMMAND')] = JSON.stringify(roleSettings.command)
    }

    if (roleSettings?.model !== undefined) {
      env[providerEnvName(providerRole, 'MODEL')] = roleSettings.model
    }

    if (roleSettings?.timeoutMs !== undefined) {
      env[providerEnvName(providerRole, 'TIMEOUT_MS')] = String(roleSettings.timeoutMs)
    }

    if (roleSettings?.url !== undefined) {
      env[providerEnvName(providerRole, 'URL')] = roleSettings.url
    }
  }

  return env
}
