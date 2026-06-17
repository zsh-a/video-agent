import type {PipelineEvent} from '@video-agent/core'

import {Args, Command, Flags} from '@oclif/core'
import {type InitialPipelineStage, PipelineCheckpointError, type ProviderCallRecord, type ProviderCallStartRecord, runInitialPipeline} from '@video-agent/runtime'
import {resolve} from 'node:path'

import {createCheckpointErrorPayload, formatCheckpointFailure} from '../utils/checkpoint-errors.js'

export default class Run extends Command {
  static args = {
    input: Args.string({description: 'Input media file to process', required: true}),
  }
  static description = 'Run the initial artifact-producing video pipeline'
  static flags = {
    'from-stage': Flags.string({
      default: 'ingest',
      description: 'Stage to start from when checkpoint artifacts already exist',
      options: ['ingest', 'understand', 'plan', 'script', 'voiceover', 'quality'],
    }),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'project-id': Flags.string({description: 'Project id to use for the workspace'}),
    trace: Flags.boolean({description: 'Write full LLM request/response traces to project artifacts'}),
    verbose: Flags.boolean({char: 'v', description: 'Print live stage and provider progress'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Run)
    const inputPath = resolve(args.input)
    const verbose = flags.verbose && !flags.json
    const verboseLogger = verbose ? new RunVerboseLogger((line) => this.log(line)) : undefined
    let output: Awaited<ReturnType<typeof runInitialPipeline>>

    try {
      output = await runInitialPipeline({
        fromStage: flags['from-stage'] as InitialPipelineStage,
        inputPath,
        onEvent: verboseLogger === undefined ? undefined : (event) => verboseLogger.event(event),
        onProviderCall: verboseLogger === undefined ? undefined : (call) => verboseLogger.providerCall(call),
        onProviderCallStart: verboseLogger === undefined ? undefined : (call) => verboseLogger.providerCallStart(call),
        projectId: flags['project-id'],
        trace: flags.trace,
        workspaceDir: flags.workspace,
      })
    } catch (error) {
      if (error instanceof PipelineCheckpointError) {
        this.log(flags.json ? JSON.stringify(createCheckpointErrorPayload(error), null, 2) : formatCheckpointFailure(error))
        process.exitCode = 1
        return
      }

      throw error
    }

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Workspace: ${output.projectDir}`)
    this.log(`Artifacts: ${Object.keys(output.artifacts).length}`)
    this.log(`Status: ${output.status}`)
  }
}

class RunVerboseLogger {
  private readonly pipelineStartedAt = Date.now()
  private readonly stageStartedAt = new Map<string, number>()

  constructor(private readonly write: (line: string) => void) {}

  event(event: PipelineEvent): void {
    const eventTime = Date.parse(event.time)

    if (event.type === 'stage:start' && event.stage !== undefined) {
      this.stageStartedAt.set(stageAttemptKey(event), Number.isNaN(eventTime) ? Date.now() : eventTime)
    }

    this.write(`${this.prefix(event.time)} ${this.formatPipelineEvent(event)}`)
  }

  providerCall(call: ProviderCallRecord): void {
    this.write(`${this.prefix(call.completedAt)} ${formatProviderCall(call)}`)
  }

  providerCallStart(call: ProviderCallStartRecord): void {
    this.write(`${this.prefix(call.startedAt)} ${formatProviderCallStart(call)}`)
  }

  private formatPipelineEvent(event: PipelineEvent): string {
    const stage = event.stage ?? 'pipeline'
    const attempt = formatAttempt(event)

    if (event.type === 'stage:start') {
      return `[pipeline] ${stage} started${attempt}`
    }

    if (event.type === 'stage:complete') {
      return `[pipeline] ${stage} completed${attempt}${this.formatStageDuration(event)}`
    }

    if (event.type === 'stage:retry') {
      const delay = event.retryDelayMs === undefined ? '' : ` retryDelayMs=${event.retryDelayMs}`

      return `[pipeline] ${stage} retrying${attempt}${delay}${formatMessage(event.message)}`
    }

    if (event.type === 'stage:progress') {
      return `[pipeline] ${stage} progress${formatProgress(event)}${formatMessage(event.message)}`
    }

    if (event.type === 'stage:fail') {
      return `[pipeline] ${stage} failed${attempt}${this.formatStageDuration(event)}${formatMessage(event.message)}`
    }

    if (event.type === 'log') {
      const level = event.level === undefined ? '' : ` ${event.level}`
      const step = event.step === undefined ? '' : `.${event.step}`

      return `[pipeline]${level} ${stage}${step}${formatMessage(event.message)}${formatData(event.data)}`
    }

    if (event.type === 'artifact') {
      const artifact = event.artifact?.path

      return `[pipeline] ${stage}.artifact written${artifact === undefined ? '' : ` path=${quoteValue(artifact)}`}`
    }

    return `[pipeline] ${event.type}${formatMessage(event.message)}${formatData(event.data)}`
  }

  private formatStageDuration(event: PipelineEvent): string {
    if (event.stage === undefined) {
      return ''
    }

    const startedAt = this.stageStartedAt.get(stageAttemptKey(event))
    const endedAt = Date.parse(event.time)

    if (startedAt === undefined || Number.isNaN(endedAt)) {
      return ''
    }

    return ` duration=${formatDuration(endedAt - startedAt)}`
  }

  private prefix(time: string): string {
    const at = Date.parse(time)

    if (Number.isNaN(at)) {
      return `[+${formatDuration(Date.now() - this.pipelineStartedAt)}]`
    }

    return `[+${formatDuration(at - this.pipelineStartedAt)}]`
  }
}

function formatProviderCall(call: ProviderCallRecord): string {
  const parts = [
    '[provider]',
    call.role,
    call.provider,
    call.operation,
    call.status,
    `${call.durationMs}ms`,
    ...(call.requestId === undefined ? [] : [`requestId=${quoteValue(call.requestId)}`]),
    ...(call.model === undefined ? [] : [`model=${quoteValue(call.model)}`]),
    ...formatUsage(call.usage),
    ...formatCost(call.cost),
    ...formatProviderSummary(call),
  ]

  if (call.status === 'failed' && call.error !== undefined) {
    parts.push(`error=${quoteValue(call.error.message)}`)
  }

  return parts.join(' ')
}

function formatProviderCallStart(call: ProviderCallStartRecord): string {
  return [
    '[provider]',
    call.role,
    call.provider,
    call.operation,
    'started',
    `requestId=${quoteValue(call.requestId)}`,
    ...Object.entries(call.input).map(([key, value]) => `${key}=${formatScalar(value)}`),
  ].join(' ')
}

function formatProviderSummary(call: ProviderCallRecord): string[] {
  const values = call.status === 'succeeded' ? call.output : call.input

  if (values === undefined) {
    return []
  }

  return Object.entries(values).map(([key, value]) => `${key}=${formatScalar(value)}`)
}

function formatAttempt(event: PipelineEvent): string {
  if (event.attempt === undefined) {
    return ''
  }

  if (event.maxAttempts === undefined) {
    return ` attempt=${event.attempt}`
  }

  return ` attempt=${event.attempt}/${event.maxAttempts}`
}

function formatMessage(message: string | undefined): string {
  return message === undefined ? '' : ` message=${quoteValue(message)}`
}

function formatProgress(event: PipelineEvent): string {
  const parts = [
    ...(event.current === undefined ? [] : [`current=${event.current}`]),
    ...(event.total === undefined ? [] : [`total=${event.total}`]),
    ...(event.percent === undefined ? [] : [`percent=${formatPercent(event.percent)}`]),
    ...(event.unit === undefined ? [] : [`unit=${event.unit}`]),
  ]

  return parts.length === 0 ? '' : ` ${parts.join(' ')}`
}

function formatData(data: Record<string, unknown> | undefined): string {
  if (data === undefined || Object.keys(data).length === 0) {
    return ''
  }

  return ` ${Object.entries(data).map(([key, value]) => `${key}=${formatScalar(value)}`).join(' ')}`
}

function formatUsage(usage: ProviderCallRecord['usage']): string[] {
  if (usage === undefined) {
    return []
  }

  return Object.entries(usage).map(([key, value]) => `usage.${key}=${formatScalar(value)}`)
}

function formatCost(cost: ProviderCallRecord['cost']): string[] {
  if (cost === undefined) {
    return []
  }

  return [
    `cost.amount=${formatScalar(cost.amount)}`,
    `cost.currency=${quoteValue(cost.currency)}`,
    ...(cost.estimated === undefined ? [] : [`cost.estimated=${formatScalar(cost.estimated)}`]),
  ]
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') {
    return quoteValue(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (value === null) {
    return 'null'
  }

  return JSON.stringify(value)
}

function quoteValue(value: string): string {
  return JSON.stringify(value.length > 120 ? `${value.slice(0, 117)}...` : value)
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '0ms'
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }

  return `${(ms / 1000).toFixed(1)}s`
}

function formatPercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1)
}

function stageAttemptKey(event: PipelineEvent): string {
  return `${event.stage ?? 'pipeline'}:${event.attempt ?? 1}`
}
