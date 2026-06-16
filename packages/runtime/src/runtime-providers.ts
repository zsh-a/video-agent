import type {LLMClient} from '@video-agent/llm'
import type {ProviderSet} from '@video-agent/providers'

import {createProviders} from '@video-agent/providers'

import type {AgentConfig} from './config.js'

import {readRuntimeEnv} from './env.js'
import {createProviderEnv} from './provider-settings.js'

export interface RuntimeProviderOptions {
  env?: Record<string, string | undefined>
  llmClient?: LLMClient
}

export async function createRuntimeProviders(config: AgentConfig, workspaceDir: string, options: RuntimeProviderOptions = {}): Promise<ProviderSet> {
  const env = createProviderEnv(config, options.env ?? await readRuntimeEnv(workspaceDir))

  return createProviders(config, {
    env,
    llmClient: options.llmClient,
  })
}
