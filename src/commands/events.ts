import {Args, Command, Flags} from '@oclif/core'
import {PIPELINE_EVENT_TYPES, type PipelineEventType} from '@video-agent/core'
import {PROJECT_EVENT_KINDS, PROJECT_EVENT_KIND_PIPELINE, PROVIDER_CALL_ROLES, PROVIDER_CALL_STATUS_SUCCEEDED, PROVIDER_CALL_STATUSES, type ProjectEventKind, type ProjectEventRecord, type ProviderCallRole, type ProviderCallStatus, readProjectEvents} from '@video-agent/runtime'

import {normalizeNonNegativeIntegerFlag, parseOptionalEnumFlag, workspaceFlag} from '../utils/cli-flags.js'

export default class Events extends Command {
  static args = {
    project: Args.string({description: 'Project id to inspect', required: true}),
  }
  static description = 'Read pipeline events and provider call records for a project'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    kind: Flags.string({description: 'Event kind to read', options: [...PROJECT_EVENT_KINDS]}),
    limit: Flags.integer({description: 'Limit to the last N events'}),
    role: Flags.string({description: 'Provider role filter', options: [...PROVIDER_CALL_ROLES]}),
    stage: Flags.string({description: 'Pipeline stage filter'}),
    status: Flags.string({description: 'Provider status filter', options: [...PROVIDER_CALL_STATUSES]}),
    type: Flags.string({description: 'Pipeline event type filter', options: [...PIPELINE_EVENT_TYPES]}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Events)
    const result = await readProjectEvents(args.project, {
      kind: parseOptionalEnumFlag<ProjectEventKind>(flags.kind, PROJECT_EVENT_KINDS, '--kind'),
      limit: normalizeNonNegativeIntegerFlag(flags.limit, '--limit'),
      pipelineStage: flags.stage,
      pipelineType: parseOptionalEnumFlag<PipelineEventType>(flags.type, PIPELINE_EVENT_TYPES, '--type'),
      providerRole: parseOptionalEnumFlag<ProviderCallRole>(flags.role, PROVIDER_CALL_ROLES, '--role'),
      providerStatus: parseOptionalEnumFlag<ProviderCallStatus>(flags.status, PROVIDER_CALL_STATUSES, '--status'),
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
      return
    }

    if (result.events.length === 0) {
      this.log('No events found.')
      return
    }

    for (const event of result.events) {
      this.log(formatEvent(event))
    }
  }
}

function formatEvent(record: ProjectEventRecord): string {
  if (record.kind === PROJECT_EVENT_KIND_PIPELINE) {
    const stage = record.event.stage === undefined ? '' : `\t${record.event.stage}${record.event.step === undefined ? '' : `.${record.event.step}`}`
    const level = record.event.level === undefined ? '' : `\t${record.event.level}`
    const message = record.event.message === undefined ? '' : `\t${record.event.message}`
    const artifact = record.event.artifact?.path === undefined ? '' : `\tpath=${record.event.artifact.path}`
    const progress = formatProgress(record.event)
    const data = formatData(record.event.data)

    return `${record.time}\tpipeline\t${record.event.type}${stage}${level}${message}${artifact}${progress}${data}`
  }

  const error = record.event.error === undefined ? '' : `\terror=${record.event.error.message}`
  const request = `\trequestId=${record.event.requestId}`
  const model = record.event.model === undefined ? '' : `\tmodel=${record.event.model}`
  const usage = formatData(record.event.usage, 'usage.')
  const summary = formatData(record.event.status === PROVIDER_CALL_STATUS_SUCCEEDED ? record.event.output : record.event.input)

  return `${record.time}\tprovider\t${record.event.role}\t${record.event.provider}\t${record.event.operation}\t${record.event.status}\t${record.event.durationMs}ms${request}${model}${usage}${summary}${error}`
}

function formatProgress(event: Extract<ProjectEventRecord, {kind: typeof PROJECT_EVENT_KIND_PIPELINE}>['event']): string {
  const values = {
    current: event.current,
    percent: event.percent,
    total: event.total,
    unit: event.unit,
  }

  return formatData(Object.fromEntries(Object.entries(values).filter((entry) => entry[1] !== undefined)))
}

function formatData(data: object | undefined, prefix = ''): string {
  if (data === undefined || Object.keys(data).length === 0) {
    return ''
  }

  return `\t${Object.entries(data).map(([key, value]) => `${prefix}${key}=${formatScalar(value)}`).join('\t')}`
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (value === null) {
    return 'null'
  }

  return JSON.stringify(value)
}
