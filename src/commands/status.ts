import {Args, Command, Flags} from '@oclif/core'
import {readProjectStatus} from '@video-agent/runtime'

export default class Status extends Command {
  static args = {
    project: Args.string({description: 'Project id to inspect', required: true}),
  }
  static description = 'Show project job status and artifact summary'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Status)
    const status = await readProjectStatus(args.project, flags.workspace)

    if (flags.json) {
      this.log(JSON.stringify(status, null, 2))
      return
    }

    this.log(`Project: ${status.projectId}`)
    this.log(`Status: ${status.job.status}`)
    this.log(`Artifacts: ${status.artifacts.length}`)
    this.log(`Events: ${status.summary.events.count}`)
    this.log(`Provider calls: ${status.summary.providers.total} (${status.summary.providers.failed} failed)`)
    this.log(`Quality issues: ${status.summary.quality.issues} (${status.summary.quality.errors} errors, ${status.summary.quality.warnings} warnings)`)
    this.log(
      `Render: ${status.summary.render.rendered ? status.summary.render.renderer ?? 'yes' : 'none'} (${status.summary.render.outputErrors} output errors, ${status.summary.render.outputWarnings} output warnings, ${status.summary.render.audioQualityWarnings} audio warnings, ${status.summary.render.visualErrors} visual errors, ${status.summary.render.visualWarnings} visual warnings)`,
    )

    if (status.summary.events.last !== undefined) {
      this.log(`Last event: ${status.summary.events.last.type ?? 'unknown'}${status.summary.events.last.stage === undefined ? '' : `:${status.summary.events.last.stage}`}`)
    }

    for (const stage of status.job.stages) {
      this.log(`${stage.name}: ${stage.status}`)
    }
  }
}
