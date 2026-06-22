import {Args, Command, Flags} from '@oclif/core'
import {createDeckRemotionRenderProject} from '@video-agent/pipeline-deck'

import {normalizePositiveIntegerFlag as normalizePositiveInteger, parseCommandPrefixFlag as parseCommandPrefix, workspaceFlag} from '../../utils/cli-flags.js'

export default class DeckRenderBackend extends Command {
  static args = {
    projectId: Args.string({description: 'Deck Explainer project id with timed-deck.json', required: true}),
  }

  static description = 'Render a Deck project through the external Remotion backend'

  static flags = {
    'composition-id': Flags.string({description: 'Remotion composition id'}),
    fps: Flags.integer({description: 'Renderer frames per second'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'output-dir': Flags.string({description: 'Output directory for the generated backend project'}),
    'output-path': Flags.string({description: 'Expected Remotion output path. Defaults to renders/remotion/out/final.mp4'}),
    'remotion-command': Flags.string({description: 'Remotion render command prefix, either a binary name or JSON string array'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(DeckRenderBackend)

    const output = await createDeckRemotionRenderProject({
      command: parseCommandPrefix(flags['remotion-command'], '--remotion-command'),
      compositionId: flags['composition-id'],
      fps: normalizePositiveInteger(flags.fps, '--fps'),
      outputDir: flags['output-dir'],
      outputPath: flags['output-path'],
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
    this.log(`Backend: ${output.backend}`)
    this.log(`Command cwd: ${output.commandCwd}`)
    this.log(`Command: ${output.command.join(' ')}`)
    this.log(`Output: ${output.outputPath}`)
    this.log(`Render artifact: ${output.artifactPath}`)
  }
}
