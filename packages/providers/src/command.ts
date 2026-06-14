import type {NarrationSegment} from '@video-agent/ir'

import {runProcess} from '@video-agent/media'

import type {
  ASRProvider,
  MediaInput,
  SceneFrameBatch,
  Transcript,
  TTSProvider,
  TTSSegment,
  VLMProvider,
  VLMScene,
} from './contracts.js'

import {parseTranscript, parseTtsSegments, parseVlmScenes} from './json-response.js'

export interface CommandProviderOptions {
  command: string[]
  env?: Record<string, string>
}

export class CommandASRProvider implements ASRProvider {
  constructor(private readonly options: CommandProviderOptions) {}

  async transcribe(input: MediaInput): Promise<Transcript> {
    return parseTranscript(
      await runProviderCommand(this.options, {
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
    return parseVlmScenes(
      await runProviderCommand(this.options, {
        context,
        input,
        kind: 'vlm',
        version: 1,
      }),
    )
  }
}

export class CommandTTSProvider implements TTSProvider {
  constructor(private readonly options: CommandProviderOptions) {}

  async synthesize(segments: NarrationSegment[]): Promise<TTSSegment[]> {
    return parseTtsSegments(
      await runProviderCommand(this.options, {
        kind: 'tts',
        segments,
        version: 1,
      }),
    )
  }
}

async function runProviderCommand(options: CommandProviderOptions, payload: unknown): Promise<unknown> {
  const result = await runProcess(options.command, {
    env: options.env,
    stdin: `${JSON.stringify(payload)}\n`,
  })

  if (result.code !== 0) {
    throw new Error(`Provider command failed with exit code ${result.code}: ${result.stderr}`)
  }

  try {
    return JSON.parse(result.stdout) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`Provider command returned invalid JSON: ${message}`)
  }
}
