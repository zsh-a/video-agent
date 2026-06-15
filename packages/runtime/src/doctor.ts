import {runProcess} from '@video-agent/media'
import {getProviderDescriptor, PROVIDER_ROLES, providerEnvName, type ProviderRole} from '@video-agent/providers'
import {mkdir, unlink, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import {type AgentConfig, readConfig, resolveConfigPath} from './config.js'
import {readRuntimeEnv} from './env.js'
import {listProjects} from './projects.js'
import {createProviderEnv} from './provider-settings.js'

export type HealthCheckStatus = 'fail' | 'pass' | 'warn'

export interface HealthCheck {
  details?: Record<string, unknown>
  message: string
  name: string
  status: HealthCheckStatus
}

export interface RuntimeHealthOptions {
  binaries?: {
    ffmpeg?: string
    ffprobe?: string
  }
  env?: Record<string, string | undefined>
  workspaceDir?: string
}

export interface RuntimeHealthReport {
  checks: HealthCheck[]
  configPath: string
  ok: boolean
  summary: RuntimeHealthSummary
  workspaceDir: string
}

export interface RuntimeHealthSummary {
  fail: number
  pass: number
  total: number
  warn: number
}

export async function checkRuntimeHealth(options: RuntimeHealthOptions = {}): Promise<RuntimeHealthReport> {
  const workspaceDir = resolve(options.workspaceDir ?? '.video-agent')
  const checks: HealthCheck[] = [
    checkBunRuntime(),
    await checkWorkspaceAccess(workspaceDir),
    await checkConfig(workspaceDir),
    ...(await checkProviderConfig(workspaceDir, options.env)),
    await checkProjectListing(workspaceDir),
    await checkBinary('ffmpeg', options.binaries?.ffmpeg ?? 'ffmpeg'),
    await checkBinary('ffprobe', options.binaries?.ffprobe ?? 'ffprobe'),
  ]

  return {
    checks,
    configPath: resolveConfigPath(workspaceDir),
    ok: checks.every((check) => check.status !== 'fail'),
    summary: summarizeHealthChecks(checks),
    workspaceDir,
  }
}

function summarizeHealthChecks(checks: HealthCheck[]): RuntimeHealthSummary {
  return {
    fail: checks.filter((check) => check.status === 'fail').length,
    pass: checks.filter((check) => check.status === 'pass').length,
    total: checks.length,
    warn: checks.filter((check) => check.status === 'warn').length,
  }
}

async function checkProviderConfig(workspaceDir: string, env: Record<string, string | undefined> | undefined): Promise<HealthCheck[]> {
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

function checkLLMProvider(role: ProviderRole, config: AgentConfig, env: Record<string, string | undefined> = process.env): HealthCheck {
  if (config.llm === undefined) {
    return {
      details: {provider: 'llm'},
      message: `${role} provider is llm, but llm is not configured`,
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

function checkCommandProvider(role: ProviderRole, env: Record<string, string | undefined> = process.env): HealthCheck {
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

function checkBunRuntime(): HealthCheck {
  const bun = (globalThis as typeof globalThis & {Bun?: {version?: string}}).Bun

  if (bun?.version !== undefined) {
    return {
      details: {version: bun.version},
      message: `Bun ${bun.version}`,
      name: 'bun',
      status: 'pass',
    }
  }

  return {
    details: {node: process.version},
    message: `Running on Node fallback (${process.version})`,
    name: 'bun',
    status: 'warn',
  }
}

async function checkWorkspaceAccess(workspaceDir: string): Promise<HealthCheck> {
  const checkPath = resolve(workspaceDir, '.doctor-write-check')

  try {
    await mkdir(workspaceDir, {recursive: true})
    await writeFile(checkPath, 'ok\n')
    await unlink(checkPath)

    return {
      message: 'Workspace is writable',
      name: 'workspace',
      status: 'pass',
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      name: 'workspace',
      status: 'fail',
    }
  }
}

async function checkConfig(workspaceDir: string): Promise<HealthCheck> {
  try {
    const config = await readConfig(workspaceDir)

    return {
      details: {providers: config.providers, version: config.version},
      message: 'Configuration is readable',
      name: 'config',
      status: 'pass',
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      name: 'config',
      status: 'fail',
    }
  }
}

async function checkProjectListing(workspaceDir: string): Promise<HealthCheck> {
  try {
    const projects = await listProjects(workspaceDir)

    return {
      details: {count: projects.length},
      message: `${projects.length} project${projects.length === 1 ? '' : 's'} found`,
      name: 'projects',
      status: 'pass',
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      name: 'projects',
      status: 'fail',
    }
  }
}

async function checkBinary(name: string, command: string): Promise<HealthCheck> {
  try {
    const result = await runProcess([command, '-version'])

    if (result.code === 0) {
      return {
        details: {command, version: firstLine(result.stdout || result.stderr)},
        message: `${name} is available`,
        name,
        status: 'pass',
      }
    }

    return {
      details: {command},
      message: firstLine(result.stderr) || `${name} exited with code ${result.code}`,
      name,
      status: 'fail',
    }
  } catch (error) {
    return {
      details: {command},
      message: error instanceof Error ? error.message : String(error),
      name,
      status: 'fail',
    }
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0] ?? ''
}
