import {Command, Flags} from '@oclif/core'
import {FILM_RECOVERY_ORDER_BY_VALUES, FILM_RECOVERY_STATUS_OPTIONS, recoverFilmWorkspaceJobs, type FilmRecoveryOrderBy, type FilmRecoveryStatusOption, resolveFilmRecoverableStatuses} from '@video-agent/pipeline-film'

import {normalizeNonNegativeIntegerFlag, parseOptionalEnumFlag, parseRequiredEnumFlag, workspaceFlag} from '../utils/cli-flags.js'
import {formatWorkerResult} from '../utils/worker-output.js'

export default class Worker extends Command {
  static description = 'Recover failed or interrupted Film pipeline jobs'
  static flags = {
    'dry-run': Flags.boolean({description: 'List recoverable Film jobs without rerunning them'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    limit: Flags.integer({description: 'Maximum number of recoverable Film jobs to process'}),
    'max-attempts': Flags.integer({description: 'Skip Film jobs whose recovery stage attempt is greater than or equal to this value'}),
    'order-by': Flags.string({description: 'Film recovery candidate ordering', options: [...FILM_RECOVERY_ORDER_BY_VALUES]}),
    'running-stale-after-ms': Flags.integer({description: 'Skip running Film jobs updated more recently than this threshold'}),
    status: Flags.string({default: 'active', description: 'Film job status to recover', options: [...FILM_RECOVERY_STATUS_OPTIONS]}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Worker)
    const report = await recoverFilmWorkspaceJobs({
      dryRun: flags['dry-run'],
      limit: normalizeNonNegativeIntegerFlag(flags.limit, '--limit'),
      maxAttempts: normalizeNonNegativeIntegerFlag(flags['max-attempts'], '--max-attempts'),
      orderBy: parseOptionalEnumFlag<FilmRecoveryOrderBy>(flags['order-by'], FILM_RECOVERY_ORDER_BY_VALUES, '--order-by'),
      runningStaleAfterMs: normalizeNonNegativeIntegerFlag(flags['running-stale-after-ms'], '--running-stale-after-ms'),
      statuses: resolveFilmRecoverableStatuses(parseRequiredEnumFlag<FilmRecoveryStatusOption>(flags.status, FILM_RECOVERY_STATUS_OPTIONS, '--status')),
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
      this.log(formatWorkerResult(result))
    }
  }
}
