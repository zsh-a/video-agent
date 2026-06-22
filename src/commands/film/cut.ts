import {Args, Command, Flags} from '@oclif/core'
import {createFilmCutProject} from '@video-agent/pipeline-film'

import {workspaceFlag} from '../../utils/cli-flags.js'
export default class FilmCut extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id with clip-plan.json', required: true}),
  }

  static description = 'Render Film Recap edited source from clip-plan.json'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmCut)
    const output = await createFilmCutProject({
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
    this.log(`Edited source: ${output.outputPath}`)
    this.log(`Timeline map: ${output.artifacts.outputTimelineMap}`)
    this.log(`Next: vagent film narrate ${output.projectId} --workspace ${flags.workspace}`)
  }
}
