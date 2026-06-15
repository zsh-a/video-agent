import {Args, Command, Flags} from '@oclif/core'
import {type ProjectEventRecord, type ProjectPipelineEventType, readProjectEvents} from '@video-agent/runtime'

export default class Events extends Command {
  static args = {
    project: Args.string({description: 'Project id to inspect', required: true}),
  }
  static description = 'Read pipeline events and provider call records for a project'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    kind: Flags.string({description: 'Event kind to read', options: ['pipeline', 'provider']}),
    limit: Flags.integer({description: 'Limit to the last N events'}),
    role: Flags.string({description: 'Provider role filter', options: ['asr', 'tts', 'vlm']}),
    stage: Flags.string({description: 'Pipeline stage filter'}),
    status: Flags.string({description: 'Provider status filter', options: ['failed', 'succeeded']}),
    type: Flags.string({description: 'Pipeline event type filter', options: ['artifact', 'log', 'stage:complete', 'stage:fail', 'stage:retry', 'stage:start']}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Events)
    const result = await readProjectEvents(args.project, {
      kind: flags.kind as 'pipeline' | 'provider' | undefined,
      limit: flags.limit,
      pipelineStage: flags.stage,
      pipelineType: flags.type as ProjectPipelineEventType | undefined,
      providerRole: flags.role as 'asr' | 'tts' | 'vlm' | undefined,
      providerStatus: flags.status as 'failed' | 'succeeded' | undefined,
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
  if (record.kind === 'pipeline') {
    const stage = record.event.stage === undefined ? '' : `\t${record.event.stage}${record.event.step === undefined ? '' : `.${record.event.step}`}`
    const level = record.event.level === undefined ? '' : `\t${record.event.level}`
    const message = record.event.message === undefined ? '' : `\t${record.event.message}`
    const artifact = record.event.artifact?.path === undefined ? '' : `\tpath=${record.event.artifact.path}`
    const data = formatData(record.event.data)

    return `${record.time}\tpipeline\t${record.event.type}${stage}${level}${message}${artifact}${data}`
  }

  const error = record.event.error === undefined ? '' : `\terror=${record.event.error.message}`
  const request = `\trequestId=${record.event.requestId}`
  const model = record.event.model === undefined ? '' : `\tmodel=${record.event.model}`
  const usage = formatData(record.event.usage, 'usage.')
  const summary = formatData(record.event.status === 'succeeded' ? record.event.output : record.event.input)

  return `${record.time}\tprovider\t${record.event.role}\t${record.event.provider}\t${record.event.operation}\t${record.event.status}\t${record.event.durationMs}ms${request}${model}${usage}${summary}${error}`
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
