import {Args, Command, Flags} from '@oclif/core'
import {PROVIDER_CALL_ROLES, PROVIDER_CALL_STATUSES, type ProviderCallRole, type ProviderCallStatus, readProjectProviderReport} from '@video-agent/runtime'

import {parseOptionalEnumFlag, workspaceFlag} from '../utils/cli-flags.js'
import {formatProviderReport} from '../utils/provider-report-output.js'

export default class ProviderReport extends Command {
  static args = {
    project: Args.string({description: 'Project id to inspect', required: true}),
  }
  static description = 'Summarize provider calls and LLM traces, including usage, cost, and latency for a project'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    role: Flags.string({description: 'Provider role filter', options: [...PROVIDER_CALL_ROLES]}),
    status: Flags.string({description: 'Provider call status filter', options: [...PROVIDER_CALL_STATUSES]}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ProviderReport)
    const report = await readProjectProviderReport(args.project, {
      role: parseOptionalEnumFlag<ProviderCallRole>(flags.role, PROVIDER_CALL_ROLES, '--role'),
      status: parseOptionalEnumFlag<ProviderCallStatus>(flags.status, PROVIDER_CALL_STATUSES, '--status'),
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2))
      return
    }

    this.log(formatProviderReport(report))
  }
}
