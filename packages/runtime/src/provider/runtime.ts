import type {LLMClient, LLMTraceRecorder} from '@video-agent/llm'
import type {ProviderSet} from '@video-agent/providers'

import {createLLMClientFromConfig} from '@video-agent/llm'
import {createProviders} from '@video-agent/providers'

import type {AgentConfig} from '../shared/config.js'

import {readRuntimeEnv} from '../shared/env.js'
import {createProviderEnv} from './settings.js'

export interface RuntimeProviderOptions {
  env?: Record<string, string | undefined>
  llmClient?: LLMClient
  llmTrace?: LLMTraceRecorder
}

export async function createRuntimeProviders(config: AgentConfig, workspaceDir: string, options: RuntimeProviderOptions = {}): Promise<ProviderSet> {
  const env = await createRuntimeProviderEnv(config, workspaceDir, options.env)

  return createProviders(config, {
    env,
    llmClient: options.llmClient,
    llmTrace: options.llmTrace,
  })
}

export async function createRuntimeLLMClient(config: AgentConfig, workspaceDir: string, options: RuntimeProviderOptions = {}): Promise<LLMClient | undefined> {
  if (options.llmClient !== undefined) {
    return options.llmClient
  }

  return createLLMClientFromConfig(config.llm, {
    env: await createRuntimeProviderEnv(config, workspaceDir, options.env),
    trace: options.llmTrace,
  })
}

export async function createRuntimeProviderEnv(config: AgentConfig, workspaceDir: string, env?: Record<string, string | undefined>): Promise<Record<string, string | undefined>> {
  return createProviderEnv(config, env ?? await readRuntimeEnv(workspaceDir))
}
