import {resolve} from 'node:path'

import type {LLMTraceOperation, LLMTraceStatus} from '@video-agent/llm'
import type {ProviderCallRecord, ProviderCallRole, ProviderCallStatus} from './call-record.js'
import type {z} from 'zod'

import {countCallResultStatuses} from '@video-agent/ir'
import {PROVIDER_CALL_ROLES} from './call-record.js'
import {LLM_TRACES_LOG_ARTIFACT_NAME, PROVIDER_CALLS_LOG_ARTIFACT_NAME} from '../artifacts/log-artifact-names.js'
import {LLMTraceLogLineSchema, ProviderCallLogLineSchema} from '../artifacts/log-schemas.js'
import {readParsedJsonLines} from '../shared/file-io.js'

import {DEFAULT_WORKSPACE_DIR} from '../shared/defaults.js'
type LLMTraceLogLine = z.infer<typeof LLMTraceLogLineSchema>

export interface ReadProjectProviderReportOptions {
  role?: ProviderCallRole
  status?: ProviderCallStatus | LLMTraceStatus
  workspaceDir?: string
}

export interface ProjectProviderReport {
  calls: ProviderCallRecord[]
  llmTraces: LLMTraceReportRecord[]
  projectId: string
  summary: ProviderReportSummary
}

export interface LLMTraceReportRecord {
  completedAt: string
  durationMs: number
  error?: {
    details?: Record<string, unknown>
    message: string
    name: string
    retryable?: boolean
    stack?: string
  }
  model?: string
  operation: LLMTraceOperation
  provider?: string
  requestId: string
  startedAt: string
  status: LLMTraceStatus
  usage?: LLMTraceReportUsage
  version: 1
}

export interface ProviderReportSummary {
  byModel: Record<string, ProviderReportBucket>
  byProvider: Record<string, ProviderReportBucket>
  byRole: Record<ProviderCallRole, ProviderReportBucket>
  costs: Record<string, number>
  durationMs: {
    average: number
    max: number
    total: number
  }
  failed: number
  llm: LLMTraceReportSummary
  succeeded: number
  total: number
  usage: ProviderReportUsage
}

export interface LLMTraceReportSummary {
  byModel: Record<string, LLMTraceReportBucket>
  byOperation: Record<string, LLMTraceReportBucket>
  byProvider: Record<string, LLMTraceReportBucket>
  durationMs: {
    average: number
    max: number
    total: number
  }
  failed: number
  succeeded: number
  total: number
  usage: LLMTraceReportUsage
}

export interface LLMTraceReportBucket {
  durationMs: number
  failed: number
  succeeded: number
  total: number
  usage: LLMTraceReportUsage
}

export interface LLMTraceReportUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface ProviderReportBucket {
  costs: Record<string, number>
  durationMs: number
  failed: number
  succeeded: number
  total: number
  usage: ProviderReportUsage
}

export interface ProviderReportUsage {
  audioSeconds: number
  inputCharacters: number
  inputTokens: number
  outputCharacters: number
  outputTokens: number
  totalTokens: number
}

export async function readProjectProviderReport(projectId: string, options: ReadProjectProviderReportOptions = {}): Promise<ProjectProviderReport> {
  const workspaceDir = options.workspaceDir ?? DEFAULT_WORKSPACE_DIR
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const calls = (await readParsedJsonLines(resolve(artifactsDir, PROVIDER_CALLS_LOG_ARTIFACT_NAME), ProviderCallLogLineSchema))
    .filter((call) => (options.role === undefined || call.role === options.role) && (options.status === undefined || call.status === options.status))
  const llmTraces = options.role === undefined
    ? (await readParsedJsonLines(resolve(artifactsDir, LLM_TRACES_LOG_ARTIFACT_NAME), LLMTraceLogLineSchema))
      .map(toLLMTraceReportRecord)
      .filter((trace) => options.status === undefined || trace.status === options.status)
    : []

  return {
    calls,
    llmTraces,
    projectId,
    summary: summarizeProviderReport(calls, llmTraces),
  }
}

function summarizeProviderReport(calls: ProviderCallRecord[], llmTraces: LLMTraceReportRecord[]): ProviderReportSummary {
  const callStatusCounts = countCallResultStatuses(calls)

  return {
    byModel: summarizeBuckets(calls, (call) => call.model ?? 'unknown'),
    byProvider: summarizeBuckets(calls, (call) => call.provider),
    byRole: Object.fromEntries(PROVIDER_CALL_ROLES.map((role) => [role, summarizeBucket(calls.filter((call) => call.role === role))])) as Record<ProviderCallRole, ProviderReportBucket>,
    costs: sumCosts(calls),
    durationMs: summarizeDuration(calls),
    failed: callStatusCounts.failed,
    llm: summarizeLLMTraces(llmTraces),
    succeeded: callStatusCounts.succeeded,
    total: calls.length,
    usage: sumUsage(calls),
  }
}

function toLLMTraceReportRecord(trace: LLMTraceLogLine): LLMTraceReportRecord {
  return {
    completedAt: trace.completedAt,
    durationMs: trace.durationMs,
    ...(trace.error === undefined ? {} : {error: trace.error}),
    ...(trace.model === undefined ? {} : {model: trace.model}),
    operation: trace.operation,
    ...(trace.provider === undefined ? {} : {provider: trace.provider}),
    requestId: trace.requestId,
    startedAt: trace.startedAt,
    status: trace.status,
    ...(trace.usage === undefined ? {} : {usage: normalizeLLMTraceUsage(trace.usage)}),
    version: trace.version,
  }
}

function summarizeLLMTraces(traces: LLMTraceReportRecord[]): LLMTraceReportSummary {
  const traceStatusCounts = countCallResultStatuses(traces)

  return {
    byModel: summarizeLLMBuckets(traces, (trace) => trace.model ?? 'unknown'),
    byOperation: summarizeLLMBuckets(traces, (trace) => trace.operation),
    byProvider: summarizeLLMBuckets(traces, (trace) => trace.provider ?? 'unknown'),
    durationMs: summarizeLLMDuration(traces),
    failed: traceStatusCounts.failed,
    succeeded: traceStatusCounts.succeeded,
    total: traces.length,
    usage: sumLLMTraceUsage(traces),
  }
}

function summarizeLLMBuckets(traces: LLMTraceReportRecord[], keyForTrace: (trace: LLMTraceReportRecord) => string): Record<string, LLMTraceReportBucket> {
  const buckets: Record<string, LLMTraceReportRecord[]> = {}

  for (const trace of traces) {
    const key = keyForTrace(trace)
    buckets[key] = [...(buckets[key] ?? []), trace]
  }

  return Object.fromEntries(Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucketTraces]) => [key, summarizeLLMBucket(bucketTraces)]))
}

function summarizeLLMBucket(traces: LLMTraceReportRecord[]): LLMTraceReportBucket {
  const traceStatusCounts = countCallResultStatuses(traces)

  return {
    durationMs: traces.reduce((total, trace) => total + trace.durationMs, 0),
    failed: traceStatusCounts.failed,
    succeeded: traceStatusCounts.succeeded,
    total: traces.length,
    usage: sumLLMTraceUsage(traces),
  }
}

function summarizeLLMDuration(traces: LLMTraceReportRecord[]): LLMTraceReportSummary['durationMs'] {
  const total = traces.reduce((sum, trace) => sum + trace.durationMs, 0)

  return {
    average: traces.length === 0 ? 0 : Math.round(total / traces.length),
    max: traces.reduce((max, trace) => Math.max(max, trace.durationMs), 0),
    total,
  }
}

function sumLLMTraceUsage(traces: LLMTraceReportRecord[]): LLMTraceReportUsage {
  const usage = createEmptyLLMTraceUsage()

  for (const trace of traces) {
    const traceUsage = normalizeLLMTraceUsage(trace.usage)
    usage.inputTokens += traceUsage.inputTokens
    usage.outputTokens += traceUsage.outputTokens
    usage.totalTokens += traceUsage.totalTokens
  }

  return usage
}

function normalizeLLMTraceUsage(usage: Partial<Pick<LLMTraceReportUsage, 'inputTokens' | 'outputTokens' | 'totalTokens'>> | undefined): LLMTraceReportUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
  }
}

function createEmptyLLMTraceUsage(): LLMTraceReportUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  }
}

function summarizeBuckets(calls: ProviderCallRecord[], keyForCall: (call: ProviderCallRecord) => string): Record<string, ProviderReportBucket> {
  const buckets: Record<string, ProviderCallRecord[]> = {}

  for (const call of calls) {
    const key = keyForCall(call)
    buckets[key] = [...(buckets[key] ?? []), call]
  }

  return Object.fromEntries(Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucketCalls]) => [key, summarizeBucket(bucketCalls)]))
}

function summarizeBucket(calls: ProviderCallRecord[]): ProviderReportBucket {
  const callStatusCounts = countCallResultStatuses(calls)

  return {
    costs: sumCosts(calls),
    durationMs: calls.reduce((total, call) => total + call.durationMs, 0),
    failed: callStatusCounts.failed,
    succeeded: callStatusCounts.succeeded,
    total: calls.length,
    usage: sumUsage(calls),
  }
}

function summarizeDuration(calls: ProviderCallRecord[]): ProviderReportSummary['durationMs'] {
  const total = calls.reduce((sum, call) => sum + call.durationMs, 0)

  return {
    average: calls.length === 0 ? 0 : Math.round(total / calls.length),
    max: calls.reduce((max, call) => Math.max(max, call.durationMs), 0),
    total,
  }
}

function sumCosts(calls: ProviderCallRecord[]): Record<string, number> {
  const costs: Record<string, number> = {}

  for (const call of calls) {
    if (call.cost !== undefined) {
      costs[call.cost.currency] = roundMetric((costs[call.cost.currency] ?? 0) + call.cost.amount)
    }
  }

  return costs
}

function sumUsage(calls: ProviderCallRecord[]): ProviderReportUsage {
  const usage = createEmptyUsage()

  for (const call of calls) {
    const callUsage = normalizeProviderUsage(call.usage)
    usage.audioSeconds += callUsage.audioSeconds
    usage.inputCharacters += callUsage.inputCharacters
    usage.inputTokens += callUsage.inputTokens
    usage.outputCharacters += callUsage.outputCharacters
    usage.outputTokens += callUsage.outputTokens
    usage.totalTokens += callUsage.totalTokens
  }

  usage.audioSeconds = roundMetric(usage.audioSeconds)

  return usage
}

function normalizeProviderUsage(usage: ProviderCallRecord['usage']): ProviderReportUsage {
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0

  return {
    audioSeconds: usage?.audioSeconds ?? 0,
    inputCharacters: usage?.inputCharacters ?? 0,
    inputTokens,
    outputCharacters: usage?.outputCharacters ?? 0,
    outputTokens,
    totalTokens: usage?.totalTokens ?? inputTokens + outputTokens,
  }
}

function createEmptyUsage(): ProviderReportUsage {
  return {
    audioSeconds: 0,
    inputCharacters: 0,
    inputTokens: 0,
    outputCharacters: 0,
    outputTokens: 0,
    totalTokens: 0,
  }
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
