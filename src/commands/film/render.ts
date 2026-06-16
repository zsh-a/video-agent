import {Args, Command, Flags} from '@oclif/core'
import {createFilmFinalRenderProject} from '@video-agent/pipeline-film'

export default class FilmRender extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id with edited source, audio mix, and subtitles', required: true}),
  }

  static description = 'Render the final Film Recap video from the edited source, audio mix, and subtitles'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmRender)
    const output = await createFilmFinalRenderProject({
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
    this.log(`Final video: ${output.outputPath}`)
    this.log(`Render output: ${output.artifactPath}`)
    this.log(`Next: vagent film quality-check ${output.projectId} --workspace ${flags.workspace}`)
  }
}
