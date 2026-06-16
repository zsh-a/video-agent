import type {LLMClient} from '@video-agent/llm'
import type {ProviderSet} from '@video-agent/providers'

import {createLLMClientFromConfig} from '@video-agent/llm'
import {createProviders} from '@video-agent/providers'

import type {AgentConfig} from './config.js'

import {readRuntimeEnv} from './env.js'
import {createProviderEnv} from './provider-settings.js'

export interface RuntimeProviderOptions {
  env?: Record<string, string | undefined>
  llmClient?: LLMClient
}

export async function createRuntimeProviders(config: AgentConfig, workspaceDir: string, options: RuntimeProviderOptions = {}): Promise<ProviderSet> {
  const env = await createRuntimeProviderEnv(config, workspaceDir, options.env)

  return createProviders(config, {
    env,
    llmClient: options.llmClient,
  })
}

export async function createRuntimeLLMClient(config: AgentConfig, workspaceDir: string, options: RuntimeProviderOptions = {}): Promise<LLMClient | undefined> {
  if (options.llmClient !== undefined) {
    return options.llmClient
  }

  return createLLMClientFromConfig(config.llm, {
    env: await createRuntimeProviderEnv(config, workspaceDir, options.env),
  })
}

export async function createRuntimeProviderEnv(config: AgentConfig, workspaceDir: string, env?: Record<string, string | undefined>): Promise<Record<string, string | undefined>> {
  return createProviderEnv(config, env ?? await readRuntimeEnv(workspaceDir))
}
