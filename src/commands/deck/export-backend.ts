import type {DeckRendererBackend} from '@video-agent/runtime'

import {Args, Command, Flags} from '@oclif/core'
import {createDeckRendererBackendProject} from '@video-agent/pipeline-deck'
import {DECK_RENDERER_BACKENDS} from '@video-agent/runtime'

import {normalizePositiveIntegerFlag as normalizePositiveInteger, parseRequiredEnumFlag, workspaceFlag} from '../../utils/cli-flags.js'

export default class DeckExportBackend extends Command {
  static args = {
    projectId: Args.string({description: 'Deck Explainer project id with timed-deck.json', required: true}),
  }

  static description = 'Export a Deck project to a renderer backend project'

  static flags = {
    backend: Flags.string({
      description: 'Renderer backend project to generate',
      options: [...DECK_RENDERER_BACKENDS],
      required: true,
    }),
    'composition-id': Flags.string({description: 'Remotion composition id'}),
    fps: Flags.integer({description: 'Renderer project frames per second'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    output: Flags.string({description: 'Output directory for the generated backend project'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(DeckExportBackend)
    const output = await createDeckRendererBackendProject({
      backend: parseRequiredEnumFlag<DeckRendererBackend>(flags.backend, DECK_RENDERER_BACKENDS, '--backend'),
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
