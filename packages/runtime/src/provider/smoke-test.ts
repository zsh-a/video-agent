import type {LLMClient, LLMClientConfig, LLMTraceRecord} from '@video-agent/llm'

import {createAsrProvider, createTtsProvider, createVlmProvider, ProviderExecutionError, ProviderResponseValidationError, readProviderMetadata, type ProviderCostMetadata, type ProviderUsageMetadata} from '@video-agent/providers'
import {resolve} from 'node:path'

import {readConfig} from '../shared/config.js'
import {readRuntimeEnv} from '../shared/env.js'
import {createProviderEnv} from './settings.js'

export type ProviderSmokeTestRole = 'asr' | 'tts' | 'vlm'
export type ProviderSmokeTestStatus = 'failed' | 'succeeded'

export interface ProviderSmokeTestOptions {
  env?: Record<string, string | undefined>
  framePath?: string
  llmClient?: LLMClient
  llmConfig?: LLMClientConfig
  mediaPath?: string
  roles?: ProviderSmokeTestRole[]
  text?: string
  workspaceDir?: string
}

export interface ProviderSmokeTestReport {
  certification: ProviderSmokeTestCertification
  llmTraces: ProviderSmokeTestLLMTrace[]
  ok: boolean
  results: ProviderSmokeTestResult[]
  summary: ProviderSmokeTestSummary
  workspaceDir: string
}

export interface ProviderSmokeTestCertification {
  costMetadata: ProviderCertificationStatus
  failureDetails: ProviderCertificationStatus
  retryableFailures: ProviderCertificationStatus
  traces: ProviderCertificationStatus
  usageMetadata: ProviderCertificationStatus
}

export type ProviderCertificationStatus = 'failed' | 'not-observed' | 'passed'

export interface ProviderSmokeTestSummary {
  failed: number
  failedRoles: ProviderSmokeTestRole[]
  succeeded: number
  total: number
}

export interface ProviderSmokeTestResult {
  durationMs: number
  error?: {
    code?: string
    details?: Record<string, unknown>
    message: string
    name: string
    retryable?: boolean
    validationIssues?: {
      code: string
      message: string
      path: string[]
    }[]
  }
  metadata?: {
    cost?: ProviderCostMetadata
    model?: string
    requestId?: string
    usage?: ProviderUsageMetadata
  }
  output?: ProviderSmokeTestOutput
  provider: string
  role: ProviderSmokeTestRole
  status: ProviderSmokeTestStatus
  traces: ProviderSmokeTestRoleTraceSummary
}

export interface ProviderSmokeTestRoleTraceSummary {
  failed: number
  requestIds: string[]
  succeeded: number
  total: number
}

export interface ProviderSmokeTestLLMTrace {
  durationMs: number
  error?: {
    details?: Record<string, unknown>
    message: string
    name: string
    retryable?: boolean
  }
  model?: string
  operation: LLMTraceRecord['operation']
  provider?: string
  requestId: string
  status: LLMTraceRecord['status']
  usage?: LLMTraceRecord['usage']
}

export type ProviderSmokeTestOutput =
  | {
      characters: number
      language?: string
      segments: number
      type: 'transcript'
    }
  | {
      duration: number
      paths: string[]
      segments: number
      type: 'tts'
    }
  | {
      evidence: number
      scenes: number
      type: 'scenes'
    }

const DEFAULT_ROLES: ProviderSmokeTestRole[] = ['asr', 'vlm', 'tts']

export async function runProviderSmokeTest(options: ProviderSmokeTestOptions = {}): Promise<ProviderSmokeTestReport> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const config = await readConfig(workspaceDir)
  const runtimeEnv = options.env ?? await readRuntimeEnv(workspaceDir)
  const roles = options.roles ?? DEFAULT_ROLES
  const llmTraces: LLMTraceRecord[] = []
  const results: ProviderSmokeTestResult[] = []

  /* eslint-disable no-await-in-loop */
  for (const role of roles) {
    const startedAt = Date.now()
    const traceStart = llmTraces.length

    try {
      const output = await runRoleSmokeTest(role, config.providers[role], {
        ...options,
        env: createProviderEnv(config, runtimeEnv),
        llmClient: options.llmClient,
        llmConfig: options.llmConfig ?? config.llm,
        llmTrace: {
          record(trace) {
            llmTraces.push(trace)
          },
        },
      })
      const metadata = readSmokeTestMetadata(output.raw)
      const roleTraces = llmTraces.slice(traceStart)

      results.push({
        durationMs: Date.now() - startedAt,
        ...(metadata === undefined ? {} : {metadata}),
        output: output.summary,
        provider: config.providers[role],
        role,
        status: 'succeeded',
        traces: summarizeRoleTraces(roleTraces),
      })
    } catch (error) {
      const roleTraces = llmTraces.slice(traceStart)

      results.push({
        durationMs: Date.now() - startedAt,
        error: normalizeSmokeTestError(error),
        provider: config.providers[role],
        role,
        status: 'failed',
        traces: summarizeRoleTraces(roleTraces),
      })
    }
  }
  /* eslint-enable no-await-in-loop */
  const reportTraces = llmTraces.map(toProviderSmokeTestLLMTrace)

  return {
    certification: certifyProviderSmokeTest(results, reportTraces),
    llmTraces: reportTraces,
    ok: results.every((result) => result.status === 'succeeded'),
    results,
    summary: summarizeProviderSmokeTestResults(results),
    workspaceDir,
  }
}

function summarizeProviderSmokeTestResults(results: ProviderSmokeTestResult[]): ProviderSmokeTestSummary {
  return {
    failed: results.filter((result) => result.status === 'failed').length,
    failedRoles: results.filter((result) => result.status === 'failed').map((result) => result.role),
    succeeded: results.filter((result) => result.status === 'succeeded').length,
    total: results.length,
  }
}

function normalizeSmokeTestError(error: unknown): NonNullable<ProviderSmokeTestResult['error']> {
  if (error instanceof ProviderExecutionError) {
    return {
      code: error.code,
      ...(error.details === undefined ? {} : {details: error.details}),
      message: error.message,
      name: error.name,
      retryable: error.retryable,
    }
  }

  if (error instanceof ProviderResponseValidationError) {
    return {
      message: error.message,
      name: error.name,
      retryable: false,
      validationIssues: error.issues,
    }
  }

  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : 'Error',
  }
}

async function runRoleSmokeTest(role: ProviderSmokeTestRole, provider: string, options: ProviderSmokeTestOptions & {llmTrace?: {record(trace: LLMTraceRecord): void}}): Promise<{raw: object; summary: ProviderSmokeTestOutput}> {
  if (role === 'asr') {
    const transcript = await createAsrProvider(provider, {env: options.env, llmClient: options.llmClient, llmConfig: options.llmConfig, llmTrace: options.llmTrace}).transcribe({
      mimeType: 'audio/wav',
      path: options.mediaPath ?? 'provider-smoke-test.wav',
    })

    return {
      raw: transcript,
      summary: {
        characters: transcript.text.length,
        ...(transcript.language === undefined ? {} : {language: transcript.language}),
        segments: transcript.segments.length,
        type: 'transcript',
      },
    }
  }

  if (role === 'tts') {
    const segments = await createTtsProvider(provider, {env: options.env, llmClient: options.llmClient, llmConfig: options.llmConfig, llmTrace: options.llmTrace}).synthesize(
      [
        {
          duration: 1,
          id: 'provider-smoke-test',
          start: 0,
          text: options.text ?? 'Provider smoke test narration.',
        },
      ],
      {
        outputDir: resolve(options.workspaceDir ?? '.video-agent', 'provider-smoke-test', 'tts'),
        pathPrefix: 'provider-smoke-test/tts',
      },
    )

    return {
      raw: segments,
      summary: {
        duration: segments.reduce((total, segment) => total + segment.duration, 0),
        paths: segments.map((segment) => segment.path),
        segments: segments.length,
        type: 'tts',
      },
    }
  }

  const scenes = await createVlmProvider(provider, {env: options.env, llmClient: options.llmClient, llmConfig: options.llmConfig, llmTrace: options.llmTrace}).analyzeScenes([
    {
      frames: [options.framePath ?? 'provider-smoke-test-frame.jpg'],
      sceneId: 'provider-smoke-test-scene',
      timeRange: [0, 1],
    },
  ], 'Provider smoke test visual context.')

  return {
    raw: scenes,
    summary: {
      evidence: scenes.reduce((total, scene) => total + scene.evidence.length, 0),
      scenes: scenes.length,
      type: 'scenes',
    },
  }
}

function readSmokeTestMetadata(value: object): ProviderSmokeTestResult['metadata'] {
  const metadata = readProviderMetadata(value)

  if (metadata === undefined) {
    return undefined
  }

  return {
    ...(metadata.cost === undefined ? {} : {cost: metadata.cost}),
    ...(metadata.model === undefined ? {} : {model: metadata.model}),
    ...(metadata.requestId === undefined ? {} : {requestId: metadata.requestId}),
    ...(metadata.usage === undefined ? {} : {usage: metadata.usage}),
  }
}

function summarizeRoleTraces(traces: LLMTraceRecord[]): ProviderSmokeTestRoleTraceSummary {
  return {
    failed: traces.filter((trace) => trace.status === 'failed').length,
    requestIds: traces.map((trace) => trace.requestId),
    succeeded: traces.filter((trace) => trace.status === 'succeeded').length,
    total: traces.length,
  }
}

function toProviderSmokeTestLLMTrace(trace: LLMTraceRecord): ProviderSmokeTestLLMTrace {
  return {
    durationMs: trace.durationMs,
    ...(trace.error === undefined
      ? {}
      : {
          error: {
            ...(trace.error.details === undefined ? {} : {details: trace.error.details}),
            message: trace.error.message,
            name: trace.error.name,
            ...(trace.error.retryable === undefined ? {} : {retryable: trace.error.retryable}),
          },
        }),
    ...(trace.model === undefined ? {} : {model: trace.model}),
    operation: trace.operation,
    ...(trace.provider === undefined ? {} : {provider: trace.provider}),
    requestId: trace.requestId,
    status: trace.status,
    ...(trace.usage === undefined ? {} : {usage: trace.usage}),
  }
}

function certifyProviderSmokeTest(results: ProviderSmokeTestResult[], traces: ProviderSmokeTestLLMTrace[]): ProviderSmokeTestCertification {
  return {
    costMetadata: certifyObserved(results.some((result) => result.metadata?.cost !== undefined), results.every((result) => result.status === 'succeeded')),
    failureDetails: results.some((result) => result.status === 'failed')
      ? (results.every((result) => result.status === 'succeeded' || result.error?.message !== undefined) ? 'passed' : 'failed')
      : 'not-observed',
    retryableFailures: results.some((result) => result.status === 'failed')
      ? (results.every((result) => result.status === 'succeeded' || result.error?.retryable !== undefined) ? 'passed' : 'failed')
      : 'not-observed',
    traces: certifyObserved(traces.length > 0, true),
    usageMetadata: certifyObserved(results.some((result) => result.metadata?.usage !== undefined), results.every((result) => result.status === 'succeeded')),
  }
}

function certifyObserved(observed: boolean, passed: boolean): ProviderCertificationStatus {
  if (!observed) {
    return 'not-observed'
  }

  return passed ? 'passed' : 'failed'
}
