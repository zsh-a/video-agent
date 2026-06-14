import {Args, Command, Flags} from '@oclif/core'
import {type ProjectEventRecord, readProjectEvents} from '@video-agent/runtime'

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
    status: Flags.string({description: 'Provider status filter', options: ['failed', 'succeeded']}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Events)
    const result = await readProjectEvents(args.project, {
      kind: flags.kind as 'pipeline' | 'provider' | undefined,
      limit: flags.limit,
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
    return `${record.time}\tpipeline\t${record.event.type}${record.event.stage === undefined ? '' : `\t${record.event.stage}`}${record.event.message === undefined ? '' : `\t${record.event.message}`}`
  }

  return `${record.time}\tprovider\t${record.event.role}\t${record.event.operation}\t${record.event.status}\t${record.event.durationMs}ms`
}
