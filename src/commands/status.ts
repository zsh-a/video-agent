import {Args, Command, Flags} from '@oclif/core'
import {readProjectStatus} from '@video-agent/runtime'

import {workspaceFlag} from '../utils/cli-flags.js'
import {formatProjectStatus} from '../utils/status-output.js'
export default class Status extends Command {
  static args = {
    project: Args.string({description: 'Project id to inspect', required: true}),
  }
  static description = 'Show project job status and artifact summary'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: workspaceFlag(),
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
