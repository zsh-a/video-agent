import type {AgentConfig, ConfigUpdate, JobStoreKind} from '@video-agent/runtime'

import {Command, Flags} from '@oclif/core'
import {readConfig, writeConfig} from '@video-agent/runtime'
import {createInterface, type Interface} from 'node:readline'

export default class Config extends Command {
  static description = 'Read or update video-agent provider configuration'
  static flags = {
    asr: Flags.string({description: 'ASR provider', options: ['command', 'http', 'mock']}),
    interactive: Flags.boolean({char: 'i', description: 'Prompt for provider, persistence, and retry settings'}),
    'job-store': Flags.string({description: 'Job state backend', options: ['json', 'sqlite']}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'max-stage-retries': Flags.integer({description: 'Retries per pipeline stage before failing'}),
    'retry-backoff-ms': Flags.integer({description: 'Delay between stage retry attempts'}),
    tts: Flags.string({description: 'TTS provider', options: ['command', 'http', 'mock']}),
    vlm: Flags.string({description: 'VLM provider', options: ['command', 'http', 'mock']}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Config)
    const hasUpdate = flags.interactive || flags.asr !== undefined || flags['job-store'] !== undefined || flags['max-stage-retries'] !== undefined || flags['retry-backoff-ms'] !== undefined || flags.tts !== undefined || flags.vlm !== undefined
    const update = flags.interactive
      ? await promptForConfig(await readConfig(flags.workspace))
      : {
          asr: flags.asr,
          jobStore: flags['job-store'] as JobStoreKind | undefined,
          maxStageRetries: flags['max-stage-retries'],
          retryBackoffMs: flags['retry-backoff-ms'],
          tts: flags.tts,
          vlm: flags.vlm,
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
    this.log(`Job store: ${result.config.persistence.jobStore}`)
    this.log(`Max stage retries: ${result.config.pipeline.maxStageRetries}`)
    this.log(`Retry backoff ms: ${result.config.pipeline.retryBackoffMs}`)

    if (result.path !== undefined) {
      this.log(`Config: ${result.path}`)
    }
  }
}

async function promptForConfig(current: AgentConfig): Promise<ConfigUpdate> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    return {
      asr: await promptChoice(rl, 'ASR provider', ['mock', 'command', 'http'], current.providers.asr),
      jobStore: (await promptChoice(rl, 'Job store', ['json', 'sqlite'], current.persistence.jobStore)) as JobStoreKind,
      maxStageRetries: await promptNonNegativeInteger(rl, 'Max stage retries', current.pipeline.maxStageRetries),
      retryBackoffMs: await promptNonNegativeInteger(rl, 'Retry backoff ms', current.pipeline.retryBackoffMs),
      tts: await promptChoice(rl, 'TTS provider', ['mock', 'command', 'http'], current.providers.tts),
      vlm: await promptChoice(rl, 'VLM provider', ['mock', 'command', 'http'], current.providers.vlm),
    }
  } finally {
    rl.close()
  }
}

async function promptChoice(rl: Interface, label: string, choices: readonly string[], current: string): Promise<string> {
  /* eslint-disable no-await-in-loop */
  while (true) {
    const answer = (await question(rl, `${label} (${choices.join('/')}) [${current}]: `)).trim()
    const value = answer === '' ? current : answer

    if (choices.includes(value)) {
      return value
    }

    process.stdout.write(`Expected one of: ${choices.join(', ')}\n`)
  }
  /* eslint-enable no-await-in-loop */
}

async function promptNonNegativeInteger(rl: Interface, label: string, current: number): Promise<number> {
  /* eslint-disable no-await-in-loop */
  while (true) {
    const answer = (await question(rl, `${label} [${current}]: `)).trim()

    if (answer === '') {
      return current
    }

    const value = Number(answer)

    if (Number.isInteger(value) && value >= 0) {
      return value
    }

    process.stdout.write('Expected a non-negative integer.\n')
  }
  /* eslint-enable no-await-in-loop */
}

function question(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve)
  })
}
