import {Args, Command, Flags} from '@oclif/core'
import {inspectMediaProject} from '@video-agent/runtime'

import {workspaceFlag} from '../utils/cli-flags.js'
export default class Inspect extends Command {
  static args = {
    input: Args.string({description: 'Input media file to inspect', required: true}),
  }
  static description = 'Probe a media file and write media-info.json'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'project-id': Flags.string({description: 'Project id to use for the workspace'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Inspect)
    const result = await inspectMediaProject(args.input, {
      projectId: flags['project-id'],
      workspaceDir: flags.workspace,
    })

    const output = {
      artifactPath: result.artifactPath,
      duration: result.duration,
      inputPath: result.inputPath,
      projectDir: result.projectDir,
      projectId: result.projectId,
      streams: result.streams,
    }

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${result.projectId}`)
    this.log(`Workspace: ${result.projectDir}`)
    this.log(`Artifact: ${result.artifactPath}`)
    this.log(`Duration: ${result.duration ?? 'unknown'}s`)
    this.log(`Streams: ${result.streams}`)
  }
}
