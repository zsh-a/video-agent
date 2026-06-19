import {Args, Command, Flags} from '@oclif/core'
import {type ProjectProviderReport, type ProviderCallRole, type ProviderCallStatus, readProjectProviderReport} from '@video-agent/runtime'

export default class ProviderReport extends Command {
  static args = {
    project: Args.string({description: 'Project id to inspect', required: true}),
  }
  static description = 'Summarize provider calls, usage, cost, and latency for a project'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    role: Flags.string({description: 'Provider role filter', options: ['asr', 'script', 'tts', 'vlm']}),
    status: Flags.string({description: 'Provider call status filter', options: ['failed', 'succeeded']}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ProviderReport)
    const report = await readProjectProviderReport(args.project, {
      role: flags.role as ProviderCallRole | undefined,
      status: flags.status as ProviderCallStatus | undefined,
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2))
      return
    }

    this.log(formatProviderReport(report))
  }
}

export function formatProviderReport(report: ProjectProviderReport): string {
  return [
    `Project: ${report.projectId}`,
    `Provider calls: ${report.summary.total} (${report.summary.failed} failed)`,
    `Duration: ${report.summary.durationMs.total}ms total, ${report.summary.durationMs.average}ms avg, ${report.summary.durationMs.max}ms max`,
    `Usage: ${formatUsage(report.summary.usage)}`,
    `Cost: ${formatCosts(report.summary.costs)}`,
    '',
    'By role:',
    ...Object.entries(report.summary.byRole).map(([role, bucket]) => `  ${role}: ${formatBucket(bucket)}`),
    '',
    'By provider:',
    ...formatNamedBuckets(report.summary.byProvider),
    '',
    'By model:',
    ...formatNamedBuckets(report.summary.byModel),
  ].join('\n').trimEnd()
}

function formatNamedBuckets(buckets: ProjectProviderReport['summary']['byProvider']): string[] {
  const entries = Object.entries(buckets)

  if (entries.length === 0) {
    return ['  none']
  }

  return entries.map(([name, bucket]) => `  ${name}: ${formatBucket(bucket)}`)
}

function formatBucket(bucket: ProjectProviderReport['summary']['byRole'][ProviderCallRole]): string {
  return `${bucket.total} calls, ${bucket.failed} failed, ${bucket.durationMs}ms, usage ${formatUsage(bucket.usage)}, cost ${formatCosts(bucket.costs)}`
}

function formatUsage(usage: ProjectProviderReport['summary']['usage']): string {
  const parts = [
    usage.totalTokens === 0 ? undefined : `${usage.totalTokens} tokens`,
    usage.inputTokens === 0 ? undefined : `${usage.inputTokens} input tokens`,
    usage.outputTokens === 0 ? undefined : `${usage.outputTokens} output tokens`,
    usage.inputCharacters === 0 ? undefined : `${usage.inputCharacters} input chars`,
    usage.outputCharacters === 0 ? undefined : `${usage.outputCharacters} output chars`,
    usage.audioSeconds === 0 ? undefined : `${usage.audioSeconds}s audio`,
  ].filter((part): part is string => part !== undefined)

  return parts.length === 0 ? 'none' : parts.join(', ')
}

function formatCosts(costs: Record<string, number>): string {
  const entries = Object.entries(costs)

  if (entries.length === 0) {
    return 'none'
  }

  return entries.map(([currency, amount]) => `${amount} ${currency}`).join(', ')
}
