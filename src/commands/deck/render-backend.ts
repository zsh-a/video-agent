import {Args, Command, Flags} from '@oclif/core'
import {createDeckRemotionRenderProject} from '@video-agent/pipeline-deck'

export default class DeckRenderBackend extends Command {
  static args = {
    projectId: Args.string({description: 'Deck Explainer project id with timed-deck.json', required: true}),
  }

  static description = 'Render a Deck project through an optional external renderer backend'

  static flags = {
    backend: Flags.string({default: 'remotion', description: 'Renderer backend to execute', options: ['remotion']}),
    'composition-id': Flags.string({description: 'Remotion composition id'}),
    fps: Flags.integer({description: 'Renderer frames per second'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'output-dir': Flags.string({description: 'Output directory for the generated backend project'}),
    'output-path': Flags.string({description: 'Expected Remotion output path. Defaults to renders/remotion/out/final.mp4'}),
    'remotion-command': Flags.string({description: 'Remotion render command prefix, either a binary name or JSON string array'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(DeckRenderBackend)

    if (flags.backend !== 'remotion') {
      throw new Error('Only the remotion backend can be rendered directly right now.')
    }

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

function normalizePositiveInteger(value: number | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isFinite(value) || value < 1 || Math.floor(value) !== value) {
    throw new TypeError(`${flagName} must be a positive integer.`)
  }

  return value
}

function parseCommandPrefix(value: string | undefined, flagName: string): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  const trimmed = value.trim()

  if (trimmed === '') {
    throw new TypeError(`${flagName} must not be empty.`)
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown

    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || item.length === 0)) {
      throw new TypeError(`${flagName} JSON value must be an array of non-empty strings.`)
    }

    return parsed
  }

  return [trimmed]
}
