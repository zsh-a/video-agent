import {Command, Flags} from '@oclif/core'
import {checkRuntimeHealth, parseEnvAssignments, type HealthCheck} from '@video-agent/runtime'

import {workspaceFlag} from '../utils/cli-flags.js'
export default class Doctor extends Command {
  static description = 'Check local runtime, workspace, config, and media tool availability'
  static flags = {
    env: Flags.string({
      description: 'Environment variable to use for provider health checks, formatted as KEY=VALUE. Repeatable; when set, only explicit values are inspected.',
      multiple: true,
    }),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Doctor)
    const report = await checkRuntimeHealth({
      env: flags.env === undefined ? undefined : parseEnvAssignments(flags.env, '--env value'),
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2))
      exitIfUnhealthy(this, report.ok)
      return
    }

    this.log(`Workspace: ${report.workspaceDir}`)
    this.log(`Config: ${report.configPath}`)
    this.log(`Status: ${report.ok ? 'ok' : 'failed'}`)
    this.log(`Summary: ${report.summary.pass}/${report.summary.total} passed, ${report.summary.warn} warnings, ${report.summary.fail} failed`)

    for (const check of report.checks) {
      this.log(formatCheck(check))
    }

    exitIfUnhealthy(this, report.ok)
  }
}

function formatCheck(check: HealthCheck): string {
  const marker = check.status === 'pass' ? 'ok' : check.status

  return `${check.name}: ${marker} - ${check.message}`
}

function exitIfUnhealthy(command: Command, ok: boolean): void {
  if (!ok) {
    command.exit(1)
  }
}
