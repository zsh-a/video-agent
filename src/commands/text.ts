import {Args, Command, Flags} from '@oclif/core'
import {createTextExplainerProject} from '@video-agent/runtime'
import {resolve} from 'node:path'

export default class Text extends Command {
  static args = {
    input: Args.string({description: 'Input text or markdown file to convert into a PPT-style explainer project', required: true}),
  }

  static description = 'Create a PPT-style explainer project from text'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    language: Flags.string({description: 'Narration/storyboard language tag', default: 'zh-CN'}),
    'max-slide-characters': Flags.integer({description: 'Maximum characters per generated slide', default: 260}),
    'project-id': Flags.string({description: 'Project id to use for the workspace'}),
    'slide-seconds': Flags.integer({description: 'Duration in seconds for each generated slide', default: 18}),
    title: Flags.string({description: 'Title to use for the first slide'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Text)
    const output = await createTextExplainerProject({
      inputPath: resolve(args.input),
      language: flags.language,
      maxSlideCharacters: flags['max-slide-characters'],
      projectId: flags['project-id'],
      slideSeconds: flags['slide-seconds'],
      title: flags.title,
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Workspace: ${output.projectDir}`)
    this.log(`Slides: ${output.slides}`)
    this.log(`Status: ${output.status}`)
    this.log(`Next: vagent render ${output.projectId} --workspace ${flags.workspace}`)
  }
}
