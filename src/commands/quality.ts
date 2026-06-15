import {Args, Command, Flags} from '@oclif/core'
import {readProjectQuality, readProjectQualityDetails, type RenderSummary} from '@video-agent/runtime'

export default class Quality extends Command {
  static args = {
    project: Args.string({description: 'Project id to inspect', required: true}),
  }
  static description = 'Show project quality, render diagnostics, and artifact integrity'
  static flags = {
    details: Flags.boolean({description: 'Include raw quality-report.json and render-output.json content'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
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
    this.log(`Render: ${formatQualityRenderSummary(report.render)}`)
    this.log(`Artifacts: ${report.artifacts.ok ? 'ok' : 'not ok'} (${report.artifacts.changed.length} changed, ${report.artifacts.missing.length} missing, ${report.artifacts.untracked.length} untracked)`)
  }
}

export function formatQualityRenderSummary(render: RenderSummary): string {
  const errors = render.outputErrors + render.subtitleErrors + render.audioQualityErrors + render.templateErrors + render.visualErrors
  const warnings = render.outputWarnings + render.subtitleWarnings + render.audioWarnings + render.audioQualityWarnings + render.templateWarnings + render.visualWarnings + render.missingVoiceovers
  const status = render.rendered ? 'rendered' : 'not rendered'

  return [
    `${status}, ${errors} errors, ${warnings} warnings`,
    `output ${render.outputErrors}/${render.outputWarnings}`,
    `subtitle ${render.subtitleErrors}/${render.subtitleWarnings}`,
    `audio ${render.audioQualityErrors}/${render.audioQualityWarnings + render.audioWarnings + render.missingVoiceovers}`,
    `template ${render.templateErrors}/${render.templateWarnings}`,
    `visual ${render.visualErrors}/${render.visualWarnings}`,
  ].join(', ')
}
