import {Args, Command, Flags} from '@oclif/core'
import {createFilmStoryIndexProject} from '@video-agent/pipeline-film'

export default class FilmBuildStoryIndex extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id with source understanding artifacts', required: true}),
  }

  static description = 'Build Film Recap story index and narrative beat artifacts'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    language: Flags.string({description: 'Story index language tag', default: 'zh-CN'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmBuildStoryIndex)
    const output = await createFilmStoryIndexProject({
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
    this.log(`Beats: ${output.beats}`)
    this.log(`Story index: ${output.artifacts.storyIndex}`)
    this.log(`Next: vagent film write-script ${output.projectId} --workspace ${flags.workspace}`)
  }
}
