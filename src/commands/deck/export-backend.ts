import type {DeckRendererBackend} from '@video-agent/pipeline-deck'

import {Args, Command, Flags} from '@oclif/core'
import {createDeckRendererBackendProject} from '@video-agent/pipeline-deck'

export default class DeckExportBackend extends Command {
  static args = {
    projectId: Args.string({description: 'Deck Explainer project id with timed-deck.json', required: true}),
  }

  static description = 'Export a Deck project to an optional renderer backend project'

  static flags = {
    backend: Flags.string({
      default: 'remotion',
      description: 'Renderer backend project to generate',
      options: ['remotion', 'motion-canvas'],
    }),
    'composition-id': Flags.string({description: 'Remotion composition id'}),
    fps: Flags.integer({description: 'Renderer project frames per second'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    output: Flags.string({description: 'Output directory for the generated backend project'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(DeckExportBackend)
    const output = await createDeckRendererBackendProject({
      backend: flags.backend as DeckRendererBackend,
      compositionId: flags['composition-id'],
      fps: normalizePositiveInteger(flags.fps, '--fps'),
      outputDir: flags.output,
      projectId: args.projectId,
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Workspace: ${output.projectDir}`)
    this.log(`Backend: ${output.backend}`)
    this.log(`Output: ${output.outputDir}`)
    this.log(`FPS: ${output.fps}`)
    this.log(`Command cwd: ${output.commandCwd}`)
    this.log(`Preview: ${output.previewCommand.join(' ')}`)
    this.log(`Render: ${output.renderCommand.join(' ')}`)
    this.log(`Artifact: ${output.artifactPath}`)
  }
}

function normalizePositiveInteger(value: number | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isFinite(value) || value < 1 || Math.floor(value) !== value) {
    throw new TypeError(`${flagName} must be a positive integer.`)
  }

  return value
}
