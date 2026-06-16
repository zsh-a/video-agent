import {Args, Command, Flags} from '@oclif/core'
import {createFilmVoiceoverProject} from '@video-agent/pipeline-film'

export default class FilmSynthesizeVoice extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id with narration.json', required: true}),
  }

  static description = 'Synthesize Film Recap voiceover segments from narration'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmSynthesizeVoice)
    const output = await createFilmVoiceoverProject({
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
    this.log(`TTS segments: ${output.artifacts.ttsSegments}`)
    this.log(`Next: vagent film mix-audio ${output.projectId} --workspace ${flags.workspace}`)
  }
}
