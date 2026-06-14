import {Args, Command, Flags} from '@oclif/core'
import {probeMedia} from '@video-agent/media'
import {createProjectWorkspace} from '@video-agent/runtime'
import {access} from 'node:fs/promises'
import {resolve} from 'node:path'

export default class Inspect extends Command {
  static args = {
    input: Args.string({description: 'Input media file to inspect', required: true}),
  }
  static description = 'Probe a media file and write media-info.json'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'project-id': Flags.string({description: 'Project id to use for the workspace'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Inspect)
    const inputPath = resolve(args.input)

    await access(inputPath)

    const workspace = await createProjectWorkspace({
      inputPath,
      projectId: flags['project-id'],
      workspaceDir: flags.workspace,
    })
    const mediaInfo = await probeMedia(inputPath)
    const artifactPath = await workspace.store.writeJson('media-info.json', mediaInfo)

    const output = {
      artifactPath,
      duration: mediaInfo.duration,
      inputPath,
      projectDir: workspace.projectDir,
      projectId: workspace.projectId,
      streams: mediaInfo.streams.length,
    }

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${workspace.projectId}`)
    this.log(`Workspace: ${workspace.projectDir}`)
    this.log(`Artifact: ${artifactPath}`)
    this.log(`Duration: ${mediaInfo.duration ?? 'unknown'}s`)
    this.log(`Streams: ${mediaInfo.streams.length}`)
  }
}
