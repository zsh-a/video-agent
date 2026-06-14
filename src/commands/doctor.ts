import {Command, Flags} from '@oclif/core'
import {checkRuntimeHealth, type HealthCheck} from '@video-agent/runtime'

export default class Doctor extends Command {
  static description = 'Check local runtime, workspace, config, and media tool availability'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Doctor)
    const report = await checkRuntimeHealth({workspaceDir: flags.workspace})

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2))
      return
    }

    this.log(`Workspace: ${report.workspaceDir}`)
    this.log(`Config: ${report.configPath}`)
    this.log(`Status: ${report.ok ? 'ok' : 'failed'}`)

    for (const check of report.checks) {
      this.log(formatCheck(check))
    }
  }
}

function formatCheck(check: HealthCheck): string {
  const marker = check.status === 'pass' ? 'ok' : check.status

  return `${check.name}: ${marker} - ${check.message}`
}
