import {Args, Command, Flags} from '@oclif/core'
import {createFilmQualityCheckProject} from '@video-agent/pipeline-film'

export default class FilmQualityCheck extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id with render-output.json', required: true}),
  }

  static description = 'Write Film Recap quality-report.json from final render diagnostics'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmQualityCheck)
    const output = await createFilmQualityCheckProject({
      projectId: args.projectId,
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Workspace: ${output.projectDir}`)
    this.log(`Status: ${output.status}`)
    this.log(`Quality report: ${output.artifactPath}`)
    this.log(`Errors: ${output.qualityReport.summary.errors}`)
    this.log(`Warnings: ${output.qualityReport.summary.warnings}`)
  }
}
