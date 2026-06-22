import {PROVIDER_ROLES, providerEnvName, type ProviderSettings} from '@video-agent/providers'

import {bunEnv} from '../shared/bun-runtime.js'
import type {AgentConfig} from '../shared/config.js'

export function createProviderEnv(config: AgentConfig, env: Record<string, string | undefined> = bunEnv()): Record<string, string | undefined> {
  return {
    ...providerSettingsToEnv(config.providerSettings),
    ...env,
  }
}

function providerSettingsToEnv(settings: ProviderSettings): Record<string, string> {
  const env: Record<string, string> = {}

  for (const providerRole of PROVIDER_ROLES) {
    const roleSettings = settings[providerRole]

    if (roleSettings?.command !== undefined) {
      env[providerEnvName(providerRole, 'COMMAND')] = JSON.stringify(roleSettings.command)
    }
  }

  return env
}
