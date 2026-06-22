import {Args, Command, Flags} from '@oclif/core'
import {EXPORT_FORMATS, type ExportFormat, exportProject, ExportQualityError} from '@video-agent/runtime'

import {parseRequiredEnumFlag, workspaceFlag} from '../utils/cli-flags.js'
import {createExportQualityFailurePayload, formatExportQualityFailure} from '../utils/export-output.js'

export default class Export extends Command {
  static args = {
    project: Args.string({description: 'Project id to export', required: true}),
  }
  static description = 'Export a project as video or bundle'
  static flags = {
    'clean-output': Flags.boolean({description: 'Remove an existing directory output before exporting bundle format'}),
    format: Flags.string({description: 'Export format.', options: [...EXPORT_FORMATS], required: true}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    output: Flags.string({description: 'Output file or directory path'}),
    'require-quality': Flags.boolean({description: 'Refuse export when project quality, render diagnostics, or artifact integrity are not clean'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Export)
    let output

    try {
      output = await exportProject({
        cleanOutput: flags['clean-output'],
        format: parseRequiredEnumFlag<ExportFormat>(flags.format, EXPORT_FORMATS, '--format'),
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
