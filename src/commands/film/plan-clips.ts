import {Args, Command, Flags} from '@oclif/core'
import {createFilmClipPlanProject} from '@video-agent/pipeline-film'

import {parseDurationSeconds, workspaceFlag} from '../../utils/cli-flags.js'

export default class FilmPlanClips extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id with story index artifacts', required: true}),
  }

  static description = 'Plan Film Recap clips from recap script and story beats'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    target: Flags.string({description: 'Target cut duration, such as 10m, 600s, or 00:10:00'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmPlanClips)
    const output = await createFilmClipPlanProject({
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
    this.log(`Clips: ${output.clips}`)
    this.log(`Duration: ${output.duration}s`)
    this.log(`Clip plan: ${output.artifacts.clipPlan}`)
    this.log(`Next: vagent film cut ${output.projectId} --workspace ${flags.workspace}`)
  }
}
