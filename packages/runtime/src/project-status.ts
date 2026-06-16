import type {JobState} from '@video-agent/db'

import {readdir} from 'node:fs/promises'
import {join, relative, resolve, sep} from 'node:path'

import type {ProviderCallRecord, ProviderCallRole} from './provider-calls.js'

import {readConfig} from './config.js'
import {readJsonLines, readOptionalJson} from './file-io.js'
import {createConfiguredJobStore} from './job-store.js'

export interface ProjectStatus {
  artifacts: string[]
  job: JobState
  projectDir: string
  projectId: string
  summary: ProjectRuntimeSummary
}

export interface ProjectRuntimeSummary {
  events: {
    count: number
    last?: {
      stage?: string
      time?: string
      type?: string
    }
  }
  providers: {
    byRole: Record<ProviderCallRole, ProviderRoleSummary>
    costs: Record<string, number>
    failed: number
    succeeded: number
    total: number
  }
  quality: QualitySummary
  render: RenderSummary
}

export interface QualitySummary {
  errors: number
  issues: number
  warnings: number
}

export interface RenderSummary {
  audioInputs: number
  audioQualityErrors: number
  audioQualityWarnings: number
  audioWarnings: number
  missingVoiceovers: number
  output?: string
  outputErrors: number
  outputWarnings: number
  rendered: boolean
  renderer?: string
  subtitleErrors: number
  subtitleWarnings: number
  templateErrors: number
  templateWarnings: number
  visualErrors: number
  visualWarnings: number
}

export interface ProviderRoleSummary {
  costs: Record<string, number>
  failed: number
  succeeded: number
  total: number
}

export async function readProjectStatus(projectId: string, workspaceDir = '.video-agent'): Promise<ProjectStatus> {
  const resolvedWorkspaceDir = resolve(workspaceDir)
  const projectDir = resolve(resolvedWorkspaceDir, 'projects', projectId)
  const artifactsDir = resolve(projectDir, 'artifacts')
  const config = await readConfig(resolvedWorkspaceDir)
  const job = await createConfiguredJobStore({
    config,
    projectDir,
    projectId,
    workspaceDir: resolvedWorkspaceDir,
  }).read()
  const artifacts = await listArtifactNames(artifactsDir, artifactsDir)
  const summary = await readProjectRuntimeSummary(artifactsDir)

  return {
    artifacts,
    job,
    projectDir,
    projectId,
    summary,
  }
}

async function listArtifactNames(rootDir: string, currentDir: string): Promise<string[]> {
  const entries = await readdir(currentDir, {withFileTypes: true})
  const nested = await Promise.all(entries.map(async (entry): Promise<string[]> => {
    const path = join(currentDir, entry.name)

    if (entry.isDirectory()) {
      return listArtifactNames(rootDir, path)
    }

    if (!entry.isFile()) {
      return []
    }

    return [relative(rootDir, path).split(sep).join('/')]
  }))

  return nested.flat().sort((a, b) => a.localeCompare(b))
}

async function readProjectRuntimeSummary(artifactsDir: string): Promise<ProjectRuntimeSummary> {
  const [events, providerCalls, quality, render] = await Promise.all([
    readJsonLines<PipelineEventLike>(resolve(artifactsDir, 'pipeline-events.jsonl')),
    readJsonLines<ProviderCallRecord>(resolve(artifactsDir, 'provider-calls.jsonl')),
    readQualitySummary(resolve(artifactsDir, 'quality-report.json')),
    readRenderSummary(resolve(artifactsDir, 'render-output.json')),
  ])

  return {
    events: summarizeEvents(events),
    providers: summarizeProviderCalls(providerCalls),
    quality,
    render,
  }
}

function summarizeEvents(events: PipelineEventLike[]): ProjectRuntimeSummary['events'] {
  const last = events.at(-1)

  return {
    count: events.length,
    ...(last === undefined
      ? {}
      : {
          last: {
            ...(typeof last.stage === 'string' ? {stage: last.stage} : {}),
            ...(typeof last.time === 'string' ? {time: last.time} : {}),
            ...(typeof last.type === 'string' ? {type: last.type} : {}),
          },
        }),
  }
}

function summarizeProviderCalls(calls: ProviderCallRecord[]): ProjectRuntimeSummary['providers'] {
  const byRole: Record<ProviderCallRole, ProviderRoleSummary> = {
    asr: createEmptyProviderRoleSummary(),
    tts: createEmptyProviderRoleSummary(),
    vlm: createEmptyProviderRoleSummary(),
  }

  for (const call of calls) {
    byRole[call.role].total += 1

    if (call.cost !== undefined) {
      byRole[call.role].costs[call.cost.currency] = (byRole[call.role].costs[call.cost.currency] ?? 0) + call.cost.amount
    }

    if (call.status === 'failed') {
      byRole[call.role].failed += 1
    } else {
      byRole[call.role].succeeded += 1
    }
  }

  return {
    byRole,
    costs: sumProviderCosts(calls),
    failed: calls.filter((call) => call.status === 'failed').length,
    succeeded: calls.filter((call) => call.status === 'succeeded').length,
    total: calls.length,
  }
}

function createEmptyProviderRoleSummary(): ProviderRoleSummary {
  return {
    costs: {},
    failed: 0,
    succeeded: 0,
    total: 0,
  }
}

function sumProviderCosts(calls: ProviderCallRecord[]): Record<string, number> {
  const costs: Record<string, number> = {}

  for (const call of calls) {
    if (call.cost !== undefined) {
      costs[call.cost.currency] = (costs[call.cost.currency] ?? 0) + call.cost.amount
    }
  }

  return costs
}

async function readQualitySummary(path: string): Promise<QualitySummary> {
  const report = await readOptionalJson<QualityReportLike>(path)

  if (report === undefined) {
    return createEmptyQualitySummary()
  }

  if (isQualitySummary(report.summary)) {
    return {
      errors: report.summary.errors,
      issues: Array.isArray(report.issues) ? report.issues.length : report.summary.errors + report.summary.warnings,
      warnings: report.summary.warnings,
    }
  }

  if (!Array.isArray(report.issues)) {
    return createEmptyQualitySummary()
  }

  return {
    errors: report.issues.filter((issue) => isQualityIssueLike(issue) && issue.severity === 'error').length,
    issues: report.issues.length,
    warnings: report.issues.filter((issue) => isQualityIssueLike(issue) && issue.severity === 'warning').length,
  }
}

function createEmptyQualitySummary(): QualitySummary {
  return {
    errors: 0,
    issues: 0,
    warnings: 0,
  }
}

async function readRenderSummary(path: string): Promise<RenderSummary> {
  const report = await readOptionalRenderOutput(path)

  return report === undefined ? createEmptyRenderSummary() : createRenderSummary(report)
}

async function readOptionalRenderOutput(path: string): Promise<RenderOutputLike | undefined> {
  return readOptionalJson<RenderOutputLike>(path)
}

function createRenderSummary(report: RenderOutputLike): RenderSummary {
  return {
    ...readAudioRenderSummary(report),
    ...readOutputRenderSummary(report),
    rendered: true,
    ...readRendererSummary(report),
    ...readSubtitleRenderSummary(report),
    ...readTemplateRenderSummary(report),
    ...readVisualRenderSummary(report),
  }
}

function readAudioRenderSummary(report: RenderOutputLike): Pick<RenderSummary, 'audioInputs' | 'audioQualityErrors' | 'audioQualityWarnings' | 'audioWarnings' | 'missingVoiceovers'> {
  return {
    audioInputs: readFiniteNumber(report.audioInputs) ?? 0,
    audioQualityErrors: readIssueErrors(report.audioQuality),
    audioQualityWarnings: readIssueWarnings(report.audioQuality),
    audioWarnings: readArrayLength(report.audioDiagnostics, 'warnings'),
    missingVoiceovers: readArrayLength(report.audioDiagnostics, 'missingVoiceovers'),
  }
}

function readOutputRenderSummary(report: RenderOutputLike): Pick<RenderSummary, 'output' | 'outputErrors' | 'outputWarnings'> {
  return {
    ...(typeof report.outputPath === 'string' ? {output: report.outputPath} : {}),
    outputErrors: readIssueErrors(report.outputQuality),
    outputWarnings: readIssueWarnings(report.outputQuality),
  }
}

function readRendererSummary(report: RenderOutputLike): Pick<RenderSummary, 'renderer'> {
  return typeof report.renderer === 'string' ? {renderer: report.renderer} : {}
}

function readSubtitleRenderSummary(report: RenderOutputLike): Pick<RenderSummary, 'subtitleErrors' | 'subtitleWarnings'> {
  return {
    subtitleErrors: readIssueErrors(report.subtitleQuality),
    subtitleWarnings: readIssueWarnings(report.subtitleQuality),
  }
}

function readVisualRenderSummary(report: RenderOutputLike): Pick<RenderSummary, 'visualErrors' | 'visualWarnings'> {
  return {
    visualErrors: readIssueErrors(report.visualQuality),
    visualWarnings: readIssueWarnings(report.visualQuality),
  }
}

function readTemplateRenderSummary(report: RenderOutputLike): Pick<RenderSummary, 'templateErrors' | 'templateWarnings'> {
  return {
    templateErrors: readIssueErrors(report.templateQuality),
    templateWarnings: readIssueWarnings(report.templateQuality),
  }
}

function createEmptyRenderSummary(): RenderSummary {
  return {
    audioInputs: 0,
    audioQualityErrors: 0,
    audioQualityWarnings: 0,
    audioWarnings: 0,
    missingVoiceovers: 0,
    outputErrors: 0,
    outputWarnings: 0,
    rendered: false,
    subtitleErrors: 0,
    subtitleWarnings: 0,
    templateErrors: 0,
    templateWarnings: 0,
    visualErrors: 0,
    visualWarnings: 0,
  }
}

function readArrayLength(value: unknown, field: string): number {
  if (!isRecord(value) || !Array.isArray(value[field])) {
    return 0
  }

  return value[field].length
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readIssueErrors(value: IssueCountLike | undefined): number {
  return readFiniteNumber(value?.errors) ?? 0
}

function readIssueWarnings(value: IssueCountLike | undefined): number {
  return readFiniteNumber(value?.warnings) ?? 0
}

function isQualitySummary(value: unknown): value is {errors: number; warnings: number} {
  return isRecord(value) && typeof value.errors === 'number' && Number.isFinite(value.errors) && typeof value.warnings === 'number' && Number.isFinite(value.warnings)
}

function isQualityIssueLike(value: unknown): value is {severity: 'error' | 'warning'} {
  return isRecord(value) && (value.severity === 'error' || value.severity === 'warning')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface PipelineEventLike {
  stage?: unknown
  time?: unknown
  type?: unknown
}

interface QualityReportLike {
  issues?: unknown[]
  summary?: unknown
}

interface RenderOutputLike {
  audioDiagnostics?: unknown
  audioInputs?: unknown
  audioQuality?: IssueCountLike
  outputPath?: unknown
  outputQuality?: IssueCountLike
  renderer?: unknown
  subtitleQuality?: IssueCountLike
  templateQuality?: IssueCountLike
  visualQuality?: IssueCountLike
}

interface IssueCountLike {
  errors?: unknown
  warnings?: unknown
}
