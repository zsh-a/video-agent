import {runProcess} from '@video-agent/media'

import type {
  ASRProvider,
  MediaInput,
  SceneFrameBatch,
  Transcript,
  TTSInputSegment,
  TTSProvider,
  TTSSegment,
  VLMProvider,
  VLMScene,
} from './contracts.js'
import type {ProviderExecutionRole} from './errors.js'

import {ProviderExecutionError} from './errors.js'
import {parseTranscript, parseTtsSegments, parseVlmScenes} from './json-response.js'
import {SceneFrameBatchesSchema} from './schemas.js'
import {validateVlmScenesForBatches} from './vlm-validation.js'

export interface CommandProviderOptions {
  command: string[]
  env?: Record<string, string>
}

export class CommandASRProvider implements ASRProvider {
  constructor(private readonly options: CommandProviderOptions) {}

  async transcribe(input: MediaInput): Promise<Transcript> {
    return parseTranscript(
      await runProviderCommand('asr', this.options, {
        input,
        kind: 'asr',
        version: 1,
      }),
    )
  }
}

export class CommandVLMProvider implements VLMProvider {
  constructor(private readonly options: CommandProviderOptions) {}

  async analyzeScenes(input: SceneFrameBatch[], context?: string): Promise<VLMScene[]> {
    const batches = SceneFrameBatchesSchema.parse(input)

    return validateVlmScenesForBatches(parseVlmScenes(
      await runProviderCommand('vlm', this.options, {
        context,
        input: batches,
        kind: 'vlm',
        version: 1,
      }),
    ), batches)
  }
}

export class CommandTTSProvider implements TTSProvider {
  constructor(private readonly options: CommandProviderOptions) {}

  async synthesize(segments: TTSInputSegment[]): Promise<TTSSegment[]> {
    return parseTtsSegments(
      await runProviderCommand('tts', this.options, {
        kind: 'tts',
        segments,
        version: 1,
      }),
    )
  }
}

async function runProviderCommand(role: ProviderExecutionRole, options: CommandProviderOptions, payload: unknown): Promise<unknown> {
  const result = await runProcess(options.command, {
    env: options.env,
    stdin: `${JSON.stringify(payload)}\n`,
  })

  if (result.code !== 0) {
    throw new ProviderExecutionError({
      code: 'command_exit',
      details: {
        command: summarizeCommand(options.command),
        exitCode: result.code,
        stderr: summarizeDiagnosticString(result.stderr),
      },
      message: `Provider command failed with exit code ${result.code}.`,
      retryable: isRetryableCommandExit(result.code),
      role,
    })
  }

  try {
    return JSON.parse(result.stdout) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new ProviderExecutionError({
      cause: error,
      code: 'command_invalid_json',
      details: {
        command: summarizeCommand(options.command),
        stdout: summarizeDiagnosticString(result.stdout),
      },
      message: `Provider command returned invalid JSON: ${message}`,
      role,
    })
  }
}

function isRetryableCommandExit(code: number): boolean {
  return code === 124 || code === 137 || code === 143
}

function summarizeCommand(command: string[]): string[] {
  return command.slice(0, 8)
}

function summarizeDiagnosticString(value: string, limit = 2000): string | {chars: number; preview: string; truncated: true} {
  return value.length <= limit
    ? value
    : {
        chars: value.length,
        preview: value.slice(0, limit),
        truncated: true,
      }
}
