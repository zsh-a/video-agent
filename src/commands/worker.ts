import {Command, Flags} from '@oclif/core'
import {type RecoverableJobStatus, recoverWorkspaceJobs, type RecoveryOrderBy} from '@video-agent/runtime'

export default class Worker extends Command {
  static description = 'Recover failed or interrupted local pipeline jobs'
  static flags = {
    'dry-run': Flags.boolean({description: 'List recoverable jobs without rerunning them'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    limit: Flags.integer({description: 'Maximum number of recoverable jobs to process'}),
    'max-attempts': Flags.integer({description: 'Skip jobs whose recovery stage attempt is greater than or equal to this value'}),
    'order-by': Flags.string({description: 'Recovery candidate ordering', options: ['attempt', 'oldest', 'recent']}),
    'running-stale-after-ms': Flags.integer({description: 'Skip running jobs updated more recently than this threshold'}),
    status: Flags.string({default: 'active', description: 'Job status to recover', options: ['active', 'failed', 'running']}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Worker)
    const report = await recoverWorkspaceJobs({
      dryRun: flags['dry-run'],
      limit: flags.limit,
      maxAttempts: flags['max-attempts'],
      orderBy: flags['order-by'] as RecoveryOrderBy | undefined,
      runningStaleAfterMs: flags['running-stale-after-ms'],
      statuses: resolveRecoverableStatuses(flags.status),
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2))
      return
    }

    this.log(`Workspace: ${report.workspaceDir}`)
    this.log(`Mode: ${report.dryRun ? 'dry-run' : 'recover'}`)
    this.log(`Recovered: ${report.recovered}`)
    this.log(`Skipped: ${report.skipped}`)

    for (const result of report.results) {
      this.log(`${result.projectId}\t${result.status}${result.fromStage === undefined ? '' : `\t${result.fromStage}`}${result.skipReason === undefined ? '' : `\t${result.skipReason}`}${result.error === undefined ? '' : `\t${result.error}`}`)
    }
  }
}

function resolveRecoverableStatuses(status: string): RecoverableJobStatus[] {
  if (status === 'failed') {
    return ['failed']
  }

  if (status === 'running') {
    return ['running']
  }

  return ['failed', 'running']
}
