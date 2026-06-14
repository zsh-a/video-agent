import {Command, Flags} from '@oclif/core'
import {listProjects} from '@video-agent/runtime'

export default class Projects extends Command {
  static description = 'List projects in a workspace'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Projects)
    const projects = await listProjects(flags.workspace)

    if (flags.json) {
      this.log(JSON.stringify({projects}, null, 2))
      return
    }

    if (projects.length === 0) {
      this.log('No projects found.')
      return
    }

    for (const project of projects) {
      this.log(`${project.projectId}\t${project.status ?? 'unknown'}\t${project.updatedAt ?? '-'}`)
    }
  }
}
