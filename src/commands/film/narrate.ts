import {Args, Command, Flags} from '@oclif/core'
import {createFilmOutputNarrationProject} from '@video-agent/pipeline-film'

export default class FilmNarrate extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id with output-timeline-map.json', required: true}),
  }

  static description = 'Write Film Recap narration against the edited output timeline'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    language: Flags.string({description: 'Narration language tag'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmNarrate)
    const output = await createFilmOutputNarrationProject({
      language: flags.language,
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
    this.log(`Segments: ${output.segments}`)
    this.log(`Output narration: ${output.artifacts.outputNarration}`)
    this.log(`Compatible narration: ${output.artifacts.narration}`)
    this.log(`Next: vagent film synthesize-voice ${output.projectId} --workspace ${flags.workspace}`)
  }
}
