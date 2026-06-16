import {Args, Command, Flags} from '@oclif/core'
import {createFilmSubtitleProject} from '@video-agent/pipeline-film'

export default class FilmSubtitle extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id with narration.json', required: true}),
  }

  static description = 'Generate Film Recap subtitle files from output-timeline narration'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmSubtitle)
    const output = await createFilmSubtitleProject({
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
    this.log(`Subtitles: ${output.outputPath}`)
    this.log(`Subtitle artifact: ${output.artifacts.subtitles}`)
    this.log(`Next: vagent film render ${output.projectId} --workspace ${flags.workspace}`)
  }
}
