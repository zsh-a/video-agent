import {Args, Command, Flags} from '@oclif/core'
import {createFilmRecapScriptProject} from '@video-agent/pipeline-film'

import {parseDurationSeconds, workspaceFlag} from '../../utils/cli-flags.js'

export default class FilmWriteScript extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id with story-index.json', required: true}),
  }

  static description = 'Write a Film Recap third-person narration script from story beats'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    target: Flags.string({description: 'Target recap duration, such as 10m, 600s, or 00:10:00'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmWriteScript)
    const output = await createFilmRecapScriptProject({
      projectId: args.projectId,
      targetDurationSeconds: flags.target === undefined ? undefined : parseDurationSeconds(flags.target),
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Workspace: ${output.projectDir}`)
    this.log(`Status: ${output.status}`)
    this.log(`Segments: ${output.segments}`)
    this.log(`Estimated duration: ${output.totalEstimatedDuration}s`)
    this.log(`Recap script: ${output.artifacts.recapScript}`)
    this.log(`Next: vagent film plan-clips ${output.projectId} --workspace ${flags.workspace}`)
  }
}
