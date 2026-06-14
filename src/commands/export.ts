import {Args, Command, Flags} from '@oclif/core'
import {type ExportFormat, exportProject} from '@video-agent/runtime'

export default class Export extends Command {
  static args = {
    project: Args.string({description: 'Project id to export', required: true}),
  }
  static description = 'Export a rendered project'
  static flags = {
    format: Flags.string({default: 'video', description: 'Export format', options: ['video', 'hyperframes', 'bundle']}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    output: Flags.string({description: 'Output file or directory path'}),
    'require-quality': Flags.boolean({description: 'Refuse export when project quality, render diagnostics, or artifact integrity are not clean'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Export)
    const output = await exportProject({
      format: flags.format as ExportFormat,
      outputPath: flags.output,
      projectId: args.project,
      requireQuality: flags['require-quality'],
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Format: ${output.format}`)
    this.log(`Source: ${output.sourcePath}`)
    this.log(`Output: ${output.outputPath}`)
    this.log(`Quality gate: ${output.requireQuality ? 'required' : 'not required'}`)
    this.log(`Artifact: ${output.artifactPath}`)
  }
}
