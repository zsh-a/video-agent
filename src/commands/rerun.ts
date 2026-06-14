import {Args, Command, Flags} from '@oclif/core'
import {type InitialPipelineStage, rerunProject} from '@video-agent/runtime'

export default class Rerun extends Command {
  static args = {
    project: Args.string({description: 'Project id to rerun', required: true}),
  }
  static description = 'Rerun an existing project from a checkpoint stage'
  static flags = {
    'from-stage': Flags.string({
      default: 'plan',
      description: 'Stage to start from when checkpoint artifacts already exist',
      options: ['ingest', 'understand', 'plan', 'script', 'voiceover', 'quality'],
    }),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Rerun)
    const output = await rerunProject(args.project, {
      fromStage: flags['from-stage'] as InitialPipelineStage,
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Workspace: ${output.projectDir}`)
    this.log(`Artifacts: ${Object.keys(output.artifacts).length}`)
    this.log(`Status: ${output.status}`)
  }
}
