import {Args, Command, Flags} from '@oclif/core'
import {type InitialPipelineStage, PipelineCheckpointError, runInitialPipeline} from '@video-agent/runtime'
import {resolve} from 'node:path'

import {createCheckpointErrorPayload, formatCheckpointFailure} from '../utils/checkpoint-errors.js'

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
    let output: Awaited<ReturnType<typeof runInitialPipeline>>

    try {
      output = await runInitialPipeline({
        fromStage: flags['from-stage'] as InitialPipelineStage,
        inputPath,
        projectId: flags['project-id'],
        workspaceDir: flags.workspace,
      })
    } catch (error) {
      if (error instanceof PipelineCheckpointError) {
        this.log(flags.json ? JSON.stringify(createCheckpointErrorPayload(error), null, 2) : formatCheckpointFailure(error))
        process.exitCode = 1
        return
      }

      throw error
    }

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
