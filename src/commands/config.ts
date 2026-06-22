import {cancel, intro, isCancel, outro, select, text} from '@clack/prompts'
import {Command, Flags} from '@oclif/core'
import {BUILTIN_PROVIDER_NAMES, PROVIDER_PROFILE_NAMES, type ProviderName, type ProviderProfileName} from '@video-agent/providers'
import {JOB_STORE_KINDS, type AgentConfig, type ConfigUpdate, type JobStoreKind, readConfig, readProviderEnvironment, writeConfig} from '@video-agent/runtime'

import {normalizeNonNegativeIntegerFlag, parseOptionalEnumFlag, workspaceFlag} from '../utils/cli-flags.js'

const PROVIDER_CONFIG_OPTIONS = [...BUILTIN_PROVIDER_NAMES]
const JOB_STORE_PROMPT_OPTIONS = [
  {hint: 'portable project-local JSON job files', label: JOB_STORE_KINDS[0], value: JOB_STORE_KINDS[0]},
  {hint: 'workspace SQLite database through Bun SQLite', label: JOB_STORE_KINDS[1], value: JOB_STORE_KINDS[1]},
] as const

export default class Config extends Command {
  static description = 'Read or update video-agent provider configuration'
  static flags = {
    asr: Flags.string({description: 'ASR provider', options: PROVIDER_CONFIG_OPTIONS}),
    interactive: Flags.boolean({char: 'i', description: 'Prompt for provider, persistence, and retry settings'}),
    'job-store': Flags.string({description: 'Job state backend', options: [...JOB_STORE_KINDS]}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'max-stage-retries': Flags.integer({description: 'Retries per pipeline stage before failing'}),
    'provider-profile': Flags.string({description: 'Apply a hosted provider profile', options: [...PROVIDER_PROFILE_NAMES]}),
    'retry-backoff-ms': Flags.integer({description: 'Delay between stage retry attempts'}),
    tts: Flags.string({description: 'TTS provider', options: PROVIDER_CONFIG_OPTIONS}),
    vlm: Flags.string({description: 'VLM provider', options: PROVIDER_CONFIG_OPTIONS}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Config)

    if (flags.interactive && process.stdin.isTTY !== true) {
      this.error('Interactive config requires a TTY. Use explicit flags such as --asr, --vlm, --tts, --job-store, --max-stage-retries, and --retry-backoff-ms in scripts or agent clients.', {exit: 1})
    }

    const hasUpdate = flags.interactive || flags.asr !== undefined || flags['job-store'] !== undefined || flags['max-stage-retries'] !== undefined || flags['provider-profile'] !== undefined || flags['retry-backoff-ms'] !== undefined || flags.tts !== undefined || flags.vlm !== undefined
    const update = flags.interactive
      ? await promptForConfig(await readConfig(flags.workspace))
      : {
          asr: parseOptionalEnumFlag<ProviderName>(flags.asr, BUILTIN_PROVIDER_NAMES, '--asr'),
          jobStore: parseOptionalEnumFlag<JobStoreKind>(flags['job-store'], JOB_STORE_KINDS, '--job-store'),
          maxStageRetries: normalizeNonNegativeIntegerFlag(flags['max-stage-retries'], '--max-stage-retries'),
          providerProfile: parseOptionalEnumFlag<ProviderProfileName>(flags['provider-profile'], PROVIDER_PROFILE_NAMES, '--provider-profile'),
          retryBackoffMs: normalizeNonNegativeIntegerFlag(flags['retry-backoff-ms'], '--retry-backoff-ms'),
          tts: parseOptionalEnumFlag<ProviderName>(flags.tts, BUILTIN_PROVIDER_NAMES, '--tts'),
          vlm: parseOptionalEnumFlag<ProviderName>(flags.vlm, BUILTIN_PROVIDER_NAMES, '--vlm'),
        }
    const result = hasUpdate
      ? await writeConfig(flags.workspace, update)
      : {
          config: await readConfig(flags.workspace),
          path: undefined,
        }

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
      return
    }

    this.log(`ASR: ${result.config.providers.asr}`)
    this.log(`VLM: ${result.config.providers.vlm}`)
    this.log(`TTS: ${result.config.providers.tts}`)
    this.log(`Provider profile: ${result.config.providerProfile ?? 'none'}`)
    this.log(`LLM: ${summarizeLLMConfig(result.config)}`)
    this.log(`Job store: ${result.config.persistence.jobStore}`)
    this.log(`Max stage retries: ${result.config.pipeline.maxStageRetries}`)
    this.log(`Retry backoff ms: ${result.config.pipeline.retryBackoffMs}`)

    const providerEnvironment = await readProviderEnvironment(flags.workspace)
    const providerEnvironmentSummary = summarizeProviderEnvironment(providerEnvironment)

    this.log(`Provider env: ${providerEnvironmentSummary}`)

    if (providerEnvironment.summary.missingRequired.length > 0) {
      this.log(`Next: bun run dev provider-env --workspace ${flags.workspace} --shell-template`)
    }

    if (result.path !== undefined) {
      this.log(`Config: ${result.path}`)
    }
  }
}

function summarizeLLMConfig(config: AgentConfig): string {
  if (config.llm === undefined) {
    return 'disabled'
  }

  return `${config.llm.provider}:${config.llm.model}${config.llm.baseURL === undefined ? '' : ` (${config.llm.baseURL})`}`
}

async function promptForConfig(current: AgentConfig): Promise<ConfigUpdate> {
  intro('video-agent config')

  const update: ConfigUpdate = {
    asr: await promptProviderChoice('ASR provider', current.providers.asr),
    jobStore: await promptJobStoreChoice(current.persistence.jobStore),
    maxStageRetries: await promptNonNegativeInteger('Max stage retries', current.pipeline.maxStageRetries),
    retryBackoffMs: await promptNonNegativeInteger('Retry backoff ms', current.pipeline.retryBackoffMs),
    tts: await promptProviderChoice('TTS provider', current.providers.tts),
    vlm: await promptProviderChoice('VLM provider', current.providers.vlm),
  }

  outro('Configuration ready')

  return update
}

async function promptProviderChoice(label: string, current: ProviderName): Promise<ProviderName> {
  return readPromptValue(
    await select<ProviderName>({
      initialValue: current,
      message: label,
      options: [
        {hint: 'fixed-output local development provider for media roles', label: 'mock', value: 'mock'},
        {hint: 'configured LLM client for structured outputs', label: 'llm', value: 'llm'},
        {hint: 'external process adapter over JSON stdin/stdout', label: 'command', value: 'command'},
      ],
    }),
  )
}

async function promptJobStoreChoice(current: JobStoreKind): Promise<JobStoreKind> {
  return readPromptValue(
    await select<JobStoreKind>({
      initialValue: current,
      message: 'Job store',
      options: [...JOB_STORE_PROMPT_OPTIONS],
    }),
  )
}

async function promptNonNegativeInteger(label: string, current: number): Promise<number> {
  const value = readPromptValue(
    await text({
      initialValue: String(current),
      message: label,
      validate(value) {
        return parseNonNegativeInteger(value) === undefined ? 'Expected a non-negative integer.' : undefined
      },
    }),
  )

  return requireNonNegativeIntegerPromptValue(value, label)
}

function readPromptValue<T>(value: symbol | T): T {
  if (isCancel(value)) {
    cancel('Configuration cancelled')
    throw new Error('Configuration cancelled.')
  }

  return value
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value.trim())

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function requireNonNegativeIntegerPromptValue(value: string | undefined, label: string): number {
  const parsed = parseNonNegativeInteger(value)

  if (parsed === undefined) {
    throw new TypeError(`${label} must be a non-negative integer; no interactive config fallback to the previous value is allowed.`)
  }

  return parsed
}

function summarizeProviderEnvironment(report: Awaited<ReturnType<typeof readProviderEnvironment>>): string {
  if (report.summary.required === 0) {
    return 'no external provider environment required'
  }

  if (report.summary.missingRequired.length === 0) {
    return 'all required provider environment variables are configured'
  }

  return `${report.summary.missingRequired.length} required variable(s) missing: ${report.summary.missingRequired.join(', ')}`
}
