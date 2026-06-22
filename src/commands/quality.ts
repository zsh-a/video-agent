import {Args, Command, Flags} from '@oclif/core'
import {readProjectQuality, readProjectQualityDetails} from '@video-agent/runtime'

import {workspaceFlag} from '../utils/cli-flags.js'
import {formatQualityRenderSummary} from '../utils/quality-output.js'
export default class Quality extends Command {
  static args = {
    project: Args.string({description: 'Project id to inspect', required: true}),
  }
  static description = 'Show project quality, render diagnostics, and artifact integrity'
  static flags = {
    details: Flags.boolean({description: 'Include raw quality-report.json and render-output.json content'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Quality)
    const report = flags.details ? await readProjectQualityDetails(args.project, flags.workspace) : await readProjectQuality(args.project, flags.workspace)

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2))
      return
    }

    this.log(`Project: ${report.projectId}`)
    this.log(`OK: ${report.ok ? 'yes' : 'no'}`)
    this.log(`Errors: ${report.summary.errors}`)
    this.log(`Warnings: ${report.summary.warnings}`)
    this.log(`Pipeline: ${report.pipeline.errors} errors, ${report.pipeline.warnings} warnings`)
    this.log(`Content: ${report.content.errors} errors, ${report.content.warnings} warnings`)
    this.log(`Render: ${formatQualityRenderSummary(report.render)}`)
    this.log(`Artifacts: ${report.artifacts.ok ? 'ok' : 'not ok'} (${report.artifacts.summary.changed} changed, ${report.artifacts.summary.missing} missing, ${report.artifacts.summary.schemaInvalid} schema invalid, ${report.artifacts.summary.untracked} untracked)`)
  }
}
