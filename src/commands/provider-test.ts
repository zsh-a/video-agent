import type {ProviderSmokeTestResult, ProviderSmokeTestRoleOption} from '@video-agent/runtime'

import {Command, Flags} from '@oclif/core'
import {PROVIDER_CALL_STATUS_FAILED, PROVIDER_SMOKE_TEST_ROLE_OPTIONS, parseEnvAssignments, resolveProviderSmokeTestRoles, runProviderSmokeTest} from '@video-agent/runtime'

import {parseRequiredEnumFlag, workspaceFlag} from '../utils/cli-flags.js'

export default class ProviderTest extends Command {
  static description = 'Run smoke tests against configured ASR, VLM, and TTS providers'
  static flags = {
    env: Flags.string({
      description: 'Environment variable to use for provider smoke tests, formatted as KEY=VALUE. Repeatable; when set, only explicit values are inspected.',
      multiple: true,
    }),
    frame: Flags.string({description: 'Sample frame path for VLM smoke tests; required when --role all or --role vlm'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    media: Flags.string({description: 'Sample media path for ASR smoke tests; required when --role all or --role asr'}),
    role: Flags.string({default: 'all', description: 'Provider role to test', options: [...PROVIDER_SMOKE_TEST_ROLE_OPTIONS]}),
    text: Flags.string({description: 'Sample narration text for TTS smoke tests; required when --role all or --role tts'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ProviderTest)
    const report = await runProviderSmokeTest({
      env: flags.env === undefined ? undefined : parseEnvAssignments(flags.env, '--env value'),
      framePath: flags.frame,
      mediaPath: flags.media,
      roles: resolveProviderSmokeTestRoles(parseRequiredEnumFlag<ProviderSmokeTestRoleOption>(flags.role, PROVIDER_SMOKE_TEST_ROLE_OPTIONS, '--role')),
      text: flags.text,
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2))
    } else {
      this.log(`Workspace: ${report.workspaceDir}`)
      this.log(`Status: ${report.ok ? 'ok' : 'failed'}`)
      this.log(`Summary: ${report.summary.succeeded}/${report.summary.total} succeeded, ${report.summary.failed} failed`)
      this.log(`Certification: failure-details=${report.certification.failureDetails} usage=${report.certification.usageMetadata} cost=${report.certification.costMetadata} retryable=${report.certification.retryableFailures} traces=${report.certification.traces}`)

      for (const result of report.results) {
        this.log(formatResult(result))
      }
    }

    if (!report.ok) {
      this.exit(1)
    }
  }
}

function formatResult(result: ProviderSmokeTestResult): string {
  const base = `${result.role}: ${result.status} - ${result.provider} (${result.durationMs}ms)`

  if (result.status === PROVIDER_CALL_STATUS_FAILED) {
    const code = result.error?.code === undefined ? '' : ` code=${result.error.code}`
    const retryable = result.error?.retryable === undefined ? '' : ` retryable=${String(result.error.retryable)}`

    return `${base} - ${result.error?.message ?? 'unknown error'}${code}${retryable}`
  }

  const metadata = result.metadata === undefined ? '' : ` request=${result.metadata.requestId ?? 'n/a'} model=${result.metadata.model ?? 'n/a'}`
  const usage = result.metadata?.usage === undefined ? '' : ` usage=${formatUsage(result.metadata.usage)}`
  const cost = result.metadata?.cost === undefined ? '' : ` cost=${formatCost(result.metadata.cost)}`
  const traces = result.traces.total === 0 ? '' : ` traces=${result.traces.total}/${result.traces.failed}failed`
  const output = result.output === undefined ? '' : ` ${formatOutput(result.output)}`

  return `${base}${output}${metadata}${usage}${cost}${traces}`
}

function formatOutput(output: NonNullable<ProviderSmokeTestResult['output']>): string {
  if (output.type === 'transcript') {
    return `segments=${output.segments} characters=${output.characters}`
  }

  if (output.type === 'tts') {
    return `segments=${output.segments} duration=${output.duration}s paths=${output.paths.join(',')}`
  }

  return `scenes=${output.scenes} evidence=${output.evidence}`
}

function formatUsage(usage: NonNullable<NonNullable<ProviderSmokeTestResult['metadata']>['usage']>): string {
  const parts = [
    usage.totalTokens === undefined ? undefined : `${usage.totalTokens} tokens`,
    usage.inputTokens === undefined ? undefined : `${usage.inputTokens} in`,
    usage.outputTokens === undefined ? undefined : `${usage.outputTokens} out`,
    usage.audioSeconds === undefined ? undefined : `${usage.audioSeconds}s audio`,
    usage.inputCharacters === undefined ? undefined : `${usage.inputCharacters} chars`,
    usage.outputCharacters === undefined ? undefined : `${usage.outputCharacters} out-chars`,
  ].filter((part): part is string => part !== undefined)

  return parts.length === 0 ? 'none' : parts.join(',')
}

function formatCost(cost: NonNullable<NonNullable<ProviderSmokeTestResult['metadata']>['cost']>): string {
  return `${cost.amount} ${cost.currency}${cost.estimated === true ? ' estimated' : ''}`
}
