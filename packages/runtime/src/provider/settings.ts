import {providerEnvName, type ProviderRole} from '@video-agent/providers'

import {bunEnv} from '../shared/bun-runtime.js'
import type {AgentConfig, ProviderSettings} from '../shared/config.js'

export function createProviderEnv(config: AgentConfig, env: Record<string, string | undefined> = bunEnv()): Record<string, string | undefined> {
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
  }

  return env
}
