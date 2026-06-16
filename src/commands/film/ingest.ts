import {Args, Command, Flags} from '@oclif/core'
import {createFilmIngestProject} from '@video-agent/pipeline-film'
import {resolve} from 'node:path'

export default class FilmIngest extends Command {
  static args = {
    input: Args.string({description: 'Input video file for the Film Recap pipeline', required: true}),
  }

  static description = 'Run Film Recap ingest/probe and write source manifest artifacts'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'project-id': Flags.string({description: 'Project id to use for the workspace'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmIngest)
    const output = await createFilmIngestProject({
      inputPath: resolve(args.input),
      projectId: flags['project-id'],
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Workspace: ${output.projectDir}`)
    this.log(`Status: ${output.status}`)
    this.log(`Manifest: ${output.artifacts.sourceManifest}`)
  }
}
