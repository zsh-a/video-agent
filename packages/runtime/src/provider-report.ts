import {resolve} from 'node:path'

import type {ProviderCallRecord, ProviderCallRole, ProviderCallStatus} from './provider-calls.js'

import {readJsonLines} from './file-io.js'

export interface ReadProjectProviderReportOptions {
  role?: ProviderCallRole
  status?: ProviderCallStatus
  workspaceDir?: string
}

export interface ProjectProviderReport {
  calls: ProviderCallRecord[]
  projectId: string
  summary: ProviderReportSummary
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
  succeeded: number
  total: number
  usage: ProviderReportUsage
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

  return {
    calls,
    projectId,
    summary: summarizeProviderReport(calls),
  }
}

function summarizeProviderReport(calls: ProviderCallRecord[]): ProviderReportSummary {
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
    succeeded: calls.filter((call) => call.status === 'succeeded').length,
    total: calls.length,
    usage: sumUsage(calls),
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
  }

  usage.audioSeconds = roundMetric(usage.audioSeconds)
  usage.totalTokens = usage.inputTokens + usage.outputTokens

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
