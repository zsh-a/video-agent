import {resolve} from 'node:path'

import type {LLMTraceOperation, LLMTraceRecord, LLMTraceStatus} from '@video-agent/llm'
import type {ProviderCallRecord, ProviderCallRole, ProviderCallStatus} from './calls.js'

import {readJsonLines} from '../shared/file-io.js'

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
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const calls = (await readJsonLines<ProviderCallRecord>(resolve(artifactsDir, 'provider-calls.jsonl')))
    .filter((call) => (options.role === undefined || call.role === options.role) && (options.status === undefined || call.status === options.status))
  const llmTraces = options.role === undefined
    ? (await readJsonLines<LLMTraceRecord>(resolve(artifactsDir, 'llm-traces.jsonl')))
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
  return {
    byModel: summarizeBuckets(calls, (call) => call.model ?? 'unknown'),
    byProvider: summarizeBuckets(calls, (call) => call.provider),
    byRole: {
      asr: summarizeBucket(calls.filter((call) => call.role === 'asr')),
      script: summarizeBucket(calls.filter((call) => call.role === 'script')),
      tts: summarizeBucket(calls.filter((call) => call.role === 'tts')),
      vlm: summarizeBucket(calls.filter((call) => call.role === 'vlm')),
    },
    costs: sumCosts(calls),
    durationMs: summarizeDuration(calls),
    failed: calls.filter((call) => call.status === 'failed').length,
    llm: summarizeLLMTraces(llmTraces),
    succeeded: calls.filter((call) => call.status === 'succeeded').length,
    total: calls.length,
    usage: sumUsage(calls),
  }
}

function toLLMTraceReportRecord(trace: LLMTraceRecord): LLMTraceReportRecord {
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
  return {
    byModel: summarizeLLMBuckets(traces, (trace) => trace.model ?? 'unknown'),
    byOperation: summarizeLLMBuckets(traces, (trace) => trace.operation),
    byProvider: summarizeLLMBuckets(traces, (trace) => trace.provider ?? 'unknown'),
    durationMs: summarizeLLMDuration(traces),
    failed: traces.filter((trace) => trace.status === 'failed').length,
    succeeded: traces.filter((trace) => trace.status === 'succeeded').length,
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
  return {
    durationMs: traces.reduce((total, trace) => total + trace.durationMs, 0),
    failed: traces.filter((trace) => trace.status === 'failed').length,
    succeeded: traces.filter((trace) => trace.status === 'succeeded').length,
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
    usage.inputTokens += trace.usage?.inputTokens ?? 0
    usage.outputTokens += trace.usage?.outputTokens ?? 0
    usage.totalTokens += trace.usage?.totalTokens ?? 0
  }

  if (usage.totalTokens === 0) {
    usage.totalTokens = usage.inputTokens + usage.outputTokens
  }

  return usage
}

function normalizeLLMTraceUsage(usage: LLMTraceRecord['usage']): LLMTraceReportUsage {
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
  return {
    costs: sumCosts(calls),
    durationMs: calls.reduce((total, call) => total + call.durationMs, 0),
    failed: calls.filter((call) => call.status === 'failed').length,
    succeeded: calls.filter((call) => call.status === 'succeeded').length,
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
    usage.audioSeconds += call.usage?.audioSeconds ?? 0
    usage.inputCharacters += call.usage?.inputCharacters ?? 0
    usage.inputTokens += call.usage?.inputTokens ?? 0
    usage.outputCharacters += call.usage?.outputCharacters ?? 0
    usage.outputTokens += call.usage?.outputTokens ?? 0
    usage.totalTokens += call.usage?.totalTokens ?? 0
  }

  usage.audioSeconds = roundMetric(usage.audioSeconds)
  if (usage.totalTokens === 0) {
    usage.totalTokens = usage.inputTokens + usage.outputTokens
  }

  return usage
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
