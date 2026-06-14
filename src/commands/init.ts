import {Command, Flags} from '@oclif/core'
import {checkRuntimeHealth, initializeWorkspace} from '@video-agent/runtime'

export default class Init extends Command {
  static description = 'Initialize a video-agent workspace and check local media tools'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Init)
    const workspaceDir = await initializeWorkspace(flags.workspace)
    const report = await checkRuntimeHealth({workspaceDir})
    const output = {
      ...report,
      checks: Object.fromEntries(
        report.checks.map((check) => [
          check.name,
          {
            available: check.status === 'pass',
            error: check.status === 'fail' ? check.message : undefined,
            status: check.status,
          },
        ]),
      ),
    }

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Workspace: ${report.workspaceDir}`)
    this.log(`Config: ${output.configPath}`)

    for (const check of report.checks) {
      this.log(`${check.name}: ${check.status}${check.message === '' ? '' : ` - ${check.message}`}`)
    }
  }
}
