import {Args, Command, Flags} from '@oclif/core'
import {createFilmStoryIndexProject} from '@video-agent/pipeline-film'

import {workspaceFlag} from '../../utils/cli-flags.js'
export default class FilmBuildStoryIndex extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id with source understanding artifacts', required: true}),
  }

  static description = 'Build Film Recap story index and narrative beat artifacts'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    language: Flags.string({description: 'Story index language tag override; defaults to the ASR transcript language'}),
    workspace: workspaceFlag(),
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
