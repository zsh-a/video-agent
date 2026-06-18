import {Args, Command, Flags} from '@oclif/core'
import {createFilmUnderstandingProject} from '@video-agent/pipeline-film'

export default class FilmUnderstand extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id created by film ingest', required: true}),
  }

  static description = 'Run Film Recap source understanding and write evidence artifacts'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'max-scenes': Flags.integer({description: 'Maximum visual/silence-backed source scenes to create', default: 12}),
    trace: Flags.boolean({description: 'Write full LLM request/response traces to project artifacts'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmUnderstand)
    const output = await createFilmUnderstandingProject({
      maxScenes: flags['max-scenes'],
      projectId: args.projectId,
      trace: flags.trace,
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Workspace: ${output.projectDir}`)
    this.log(`Status: ${output.status}`)
    this.log(`Scenes: ${output.scenes}`)
    this.log(`Evidence: ${output.artifacts.timelineFusion}`)
    this.log(`Next: vagent film build-story-index ${output.projectId} --workspace ${flags.workspace}`)
  }
}
