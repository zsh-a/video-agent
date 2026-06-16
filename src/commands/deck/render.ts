import {Args, Command, Flags} from '@oclif/core'
import {createDeckFinalRenderProject} from '@video-agent/pipeline-deck'

export default class DeckRender extends Command {
  static args = {
    projectId: Args.string({description: 'Deck Explainer project id with timed-deck.json and deck voiceover audio', required: true}),
  }

  static description = 'Render the final Deck Explainer video from timed DeckIR and voiceover audio'

  static flags = {
    'html-output': Flags.string({description: 'Output path for optional HTML renderer capture'}),
    'html-render': Flags.boolean({default: false, description: 'Run an external HTML renderer such as HyperFrames against renders/html'}),
    'html-render-command': Flags.string({description: 'HTML renderer command prefix, either a binary name or JSON string array'}),
    'html-validate': Flags.boolean({default: false, description: 'Run external HTML renderer validation against renders/html'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(DeckRender)
    const output = await createDeckFinalRenderProject({
      htmlOutput: flags['html-output'],
      htmlRender: flags['html-render'],
      htmlRenderCommand: parseCommandPrefix(flags['html-render-command']),
      htmlValidate: flags['html-validate'],
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
    this.log(`Renderer: ${output.renderer}`)
    this.log(`HTML entry: ${output.htmlEntryPath}`)
    this.log(`HTML validated: ${output.validation === undefined ? 'no' : 'yes'}`)
    this.log(`HTML rendered: ${output.rendered === undefined ? 'no' : 'yes'}`)
    this.log(`Final video: ${output.outputPath}`)
    this.log(`Render output: ${output.artifactPath}`)
  }
}

function parseCommandPrefix(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  const trimmed = value.trim()

  if (trimmed === '') {
    throw new TypeError('--html-render-command must not be empty.')
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown

    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || item.length === 0)) {
      throw new TypeError('--html-render-command JSON value must be an array of non-empty strings.')
    }

    return parsed
  }

  return [trimmed]
}
