import {Args, Command, Flags} from '@oclif/core'
import {FILM_PIPELINE_STAGES, rerunProject} from '@video-agent/pipeline-film'
import {type PipelineStage, PipelineCheckpointError} from '@video-agent/runtime'

import {createCheckpointErrorPayload, formatCheckpointFailure} from '../utils/checkpoint-errors.js'

export default class Rerun extends Command {
  static args = {
    project: Args.string({description: 'Project id to rerun', required: true}),
  }
  static description = 'Rerun an existing project from a checkpoint stage'
  static flags = {
    'from-stage': Flags.string({
      description: 'Stage to start from when checkpoint artifacts already exist',
      options: [...FILM_PIPELINE_STAGES],
    }),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Rerun)
    let output: Awaited<ReturnType<typeof rerunProject>>

    try {
      output = await rerunProject(args.project, {
        fromStage: flags['from-stage'] as PipelineStage | undefined,
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
    this.log(`Pipeline: ${output.pipeline}`)
    this.log(`Stages: ${output.completedStages.join(', ')}`)
    this.log(`Status: ${output.status}`)
  }
}
