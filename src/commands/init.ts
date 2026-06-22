import {Command, Flags} from '@oclif/core'
import {checkRuntimeHealth, initializeWorkspace} from '@video-agent/runtime'

import {workspaceFlag} from '../utils/cli-flags.js'
export default class Init extends Command {
  static description = 'Initialize a video-agent workspace and check local media tools'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: workspaceFlag(),
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
      exitIfUnhealthy(this, report.ok)
      return
    }

    this.log(`Workspace: ${report.workspaceDir}`)
    this.log(`Config: ${output.configPath}`)
    this.log(`Summary: ${report.summary.pass}/${report.summary.total} passed, ${report.summary.warn} warnings, ${report.summary.fail} failed`)

    for (const check of report.checks) {
      this.log(`${check.name}: ${check.status}${check.message === '' ? '' : ` - ${check.message}`}`)
    }

    exitIfUnhealthy(this, report.ok)
  }
}

function exitIfUnhealthy(command: Command, ok: boolean): void {
  if (!ok) {
    command.exit(1)
  }
}
