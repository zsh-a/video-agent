import {Args, Command, Flags} from '@oclif/core'
import {type ProjectStatus, readProjectStatus} from '@video-agent/runtime'

import {formatQualityRenderSummary} from './quality.js'

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

    this.log(formatProjectStatus(status))
  }
}

export function formatProjectStatus(status: ProjectStatus): string {
  return [
    `Project: ${status.projectId}`,
    `Status: ${status.job.status}`,
    `Artifacts: ${status.artifacts.length}`,
    `Events: ${status.summary.events.count}`,
    `Provider calls: ${status.summary.providers.total} (${status.summary.providers.failed} failed)`,
    `Quality issues: ${status.summary.quality.issues} (${status.summary.quality.errors} errors, ${status.summary.quality.warnings} warnings)`,
    `Render: ${formatQualityRenderSummary(status.summary.render)}`,
    ...(status.summary.events.last === undefined ? [] : [`Last event: ${status.summary.events.last.type ?? 'unknown'}${status.summary.events.last.stage === undefined ? '' : `:${status.summary.events.last.stage}`}`]),
    ...status.job.stages.map((stage) => `${stage.name}: ${stage.status}`),
  ].join('\n')
}
