import {Args, Command, Flags} from '@oclif/core'
import {createFilmAudioMixProject} from '@video-agent/pipeline-film'

import {workspaceFlag} from '../../utils/cli-flags.js'
export default class FilmMixAudio extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id with tts-segments.json', required: true}),
  }

  static description = 'Mix Film Recap voiceover audio against the edited output timeline'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmMixAudio)
    const output = await createFilmAudioMixProject({
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
    this.log(`Audio mix: ${output.outputPath}`)
    this.log(`Audio mix plan: ${output.artifacts.audioMix}`)
    this.log(`Next: vagent film subtitle ${output.projectId} --workspace ${flags.workspace}`)
  }
}
