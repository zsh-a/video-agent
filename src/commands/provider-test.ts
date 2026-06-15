import type {ProviderSmokeTestResult, ProviderSmokeTestRole} from '@video-agent/runtime'

import {Command, Flags} from '@oclif/core'
import {runProviderSmokeTest} from '@video-agent/runtime'

import {parseEnvFlags} from '../utils/env-flags.js'

export default class ProviderTest extends Command {
  static description = 'Run smoke tests against configured ASR, VLM, and TTS providers'
  static flags = {
    env: Flags.string({
      description: 'Environment variable to use for provider smoke tests, formatted as KEY=VALUE. Repeatable; when set, only explicit values are inspected.',
      multiple: true,
    }),
    frame: Flags.string({description: 'Sample frame path for VLM smoke tests'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    media: Flags.string({description: 'Sample media path for ASR smoke tests'}),
    role: Flags.string({default: 'all', description: 'Provider role to test', options: ['all', 'asr', 'tts', 'vlm']}),
    text: Flags.string({description: 'Sample narration text for TTS smoke tests'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ProviderTest)
    const report = await runProviderSmokeTest({
      env: flags.env === undefined ? undefined : parseEnvFlags(flags.env),
      framePath: flags.frame,
      mediaPath: flags.media,
      roles: parseRoles(flags.role),
      text: flags.text,
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2))
    } else {
      this.log(`Workspace: ${report.workspaceDir}`)
      this.log(`Status: ${report.ok ? 'ok' : 'failed'}`)
      this.log(`Summary: ${report.summary.succeeded}/${report.summary.total} succeeded, ${report.summary.failed} failed`)

      for (const result of report.results) {
        this.log(formatResult(result))
      }
    }

    if (!report.ok) {
      this.exit(1)
    }
  }
}

function parseRoles(role: string): ProviderSmokeTestRole[] | undefined {
  if (role === 'all') {
    return undefined
  }

  return [role as ProviderSmokeTestRole]
}

function formatResult(result: ProviderSmokeTestResult): string {
  const base = `${result.role}: ${result.status} - ${result.provider} (${result.durationMs}ms)`

  if (result.status === 'failed') {
    return `${base} - ${result.error?.message ?? 'unknown error'}`
  }

  const metadata = result.metadata === undefined ? '' : ` request=${result.metadata.requestId ?? 'n/a'} model=${result.metadata.model ?? 'n/a'}`
  const output = result.output === undefined ? '' : ` ${formatOutput(result.output)}`

  return `${base}${output}${metadata}`
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
