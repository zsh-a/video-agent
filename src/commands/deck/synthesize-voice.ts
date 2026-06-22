import {Args, Command, Flags} from '@oclif/core'
import {createDeckVoiceoverProject} from '@video-agent/pipeline-deck'

import {workspaceFlag} from '../../utils/cli-flags.js'
export default class DeckSynthesizeVoice extends Command {
  static args = {
    projectId: Args.string({description: 'Deck Explainer project id with speaker-script.json', required: true}),
  }

  static description = 'Synthesize Deck Explainer voiceover and update slide timings'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(DeckSynthesizeVoice)
    const output = await createDeckVoiceoverProject({
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
    this.log(`Slides: ${output.slides}`)
    this.log(`Duration: ${output.duration}s`)
    this.log(`Voiceover: ${output.outputPath}`)
    this.log(`Next: vagent deck render ${output.projectId} --workspace ${flags.workspace}`)
  }
}
