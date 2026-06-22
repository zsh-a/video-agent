import {Args, Command, Flags} from '@oclif/core'
import {readProjectVisualSamples} from '@video-agent/runtime'

import {workspaceFlag} from '../utils/cli-flags.js'
import {formatVisualSample} from '../utils/visual-output.js'
export default class Visual extends Command {
  static args = {
    project: Args.string({description: 'Project id to inspect', required: true}),
  }
  static description = 'Read rendered visual frame sample metadata'
  static flags = {
    'include-content': Flags.boolean({description: 'Include base64 image content in JSON output'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Visual)
    const report = await readProjectVisualSamples(args.project, {
      includeContent: flags['include-content'],
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2))
      return
    }

    this.log(`Project: ${report.projectId}`)
    this.log(`Samples: ${report.samples.length}`)

    if (report.samples.length === 0) {
      this.log('No visual samples found. Render the project with ffmpeg first.')
      return
    }

    for (const sample of report.samples) {
      this.log(formatVisualSample(sample))
    }
  }
}
