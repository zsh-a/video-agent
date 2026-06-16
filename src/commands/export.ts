import {Args, Command, Flags} from '@oclif/core'
import {type ExportFormat, exportProject, ExportQualityError, type ProjectQualityReport} from '@video-agent/runtime'

import {formatQualityRenderSummary} from './quality.js'

export default class Export extends Command {
  static args = {
    project: Args.string({description: 'Project id to export', required: true}),
  }
  static description = 'Export a rendered project'
  static flags = {
    'clean-output': Flags.boolean({description: 'Remove an existing directory output before exporting hyperframes or bundle formats'}),
    format: Flags.string({description: 'Export format. Omit to infer from the latest render output.', options: ['video', 'hyperframes', 'bundle']}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    output: Flags.string({description: 'Output file or directory path'}),
    'require-quality': Flags.boolean({description: 'Refuse export when project quality, render diagnostics, or artifact integrity are not clean'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Export)
    let output

    try {
      output = await exportProject({
        cleanOutput: flags['clean-output'],
        format: flags.format as ExportFormat | undefined,
        outputPath: flags.output,
        projectId: args.project,
        requireQuality: flags['require-quality'],
        workspaceDir: flags.workspace,
      })
    } catch (error) {
      if (error instanceof ExportQualityError) {
        if (flags.json) {
          this.log(JSON.stringify(createExportQualityFailurePayload(error.projectId, error.quality, error.message), null, 2))
        } else {
          this.log(formatExportQualityFailure(error.projectId, error.quality))
        }

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
    this.log(`Format: ${output.format}`)
    this.log(`Source: ${output.sourcePath}`)
    this.log(`Output: ${output.outputPath}`)
    this.log(`Clean output: ${output.cleanOutput ? 'yes' : 'no'}`)
    this.log(`Quality gate: ${output.requireQuality ? 'required' : 'not required'}`)
    this.log(`Artifact: ${output.artifactPath}`)
  }
}

export function createExportQualityFailurePayload(projectId: string, quality: ProjectQualityReport, message: string): {
  error: {
    code: 'export_quality_failed'
    legacyCode: 'export.quality_failed'
    message: string
    name: 'ExportQualityError'
  }
  ok: false
  projectId: string
  quality: ProjectQualityReport
} {
  return {
    error: {
      code: 'export_quality_failed',
      legacyCode: 'export.quality_failed',
      message,
      name: 'ExportQualityError',
    },
    ok: false,
    projectId,
    quality,
  }
}

export function formatExportQualityFailure(projectId: string, quality: ProjectQualityReport): string {
  return [
    `Export blocked: project ${projectId} did not pass quality checks.`,
    `Quality: ${quality.summary.errors} errors, ${quality.summary.warnings} warnings`,
    `Pipeline: ${quality.pipeline.errors} errors, ${quality.pipeline.warnings} warnings`,
    `Content: ${quality.content.errors} errors, ${quality.content.warnings} warnings`,
    `Render: ${formatQualityRenderSummary(quality.render)}`,
    `Artifacts: ${quality.artifacts.ok ? 'ok' : 'not ok'} (${quality.artifacts.summary.changed} changed, ${quality.artifacts.summary.missing} missing, ${quality.artifacts.summary.schemaInvalid} schema invalid, ${quality.artifacts.summary.untracked} untracked)`,
  ].join('\n')
}
