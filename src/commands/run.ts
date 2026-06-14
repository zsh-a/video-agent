import {Args, Command, Flags} from '@oclif/core'
import {type InitialPipelineStage, runInitialPipeline} from '@video-agent/runtime'
import {resolve} from 'node:path'

export default class Run extends Command {
  static args = {
    input: Args.string({description: 'Input media file to process', required: true}),
  }
  static description = 'Run the initial ingest and placeholder planning pipeline'
  static flags = {
    'from-stage': Flags.string({
      default: 'ingest',
      description: 'Stage to start from when checkpoint artifacts already exist',
      options: ['ingest', 'understand', 'plan', 'script', 'voiceover', 'quality'],
    }),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'project-id': Flags.string({description: 'Project id to use for the workspace'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Run)
    const inputPath = resolve(args.input)
    const output = await runInitialPipeline({
      fromStage: flags['from-stage'] as InitialPipelineStage,
      inputPath,
      projectId: flags['project-id'],
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
