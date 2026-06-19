import type {LLMClient} from '@video-agent/llm'

import {mkdir, writeFile} from 'node:fs/promises'
import {join, posix} from 'node:path'

import type {NarrationSegment} from '@video-agent/ir'
import type {TTSProvider, TTSProviderSynthesizeOptions, TTSSegment} from '../contracts.js'

import {probeMedia} from '@video-agent/media'
import {isRecord, normalizeBaseURL, normalizeOptionalString, normalizeOutputDir, normalizePathPrefix, readStringField, sanitizePathSegment} from './media-utils.js'
import {attachProviderMetadata} from '../metadata.js'
import {ProviderExecutionError} from '../errors.js'
import {MIMO_PROVIDER_BASE_URL, MIMO_PROVIDER_MODEL_IDS} from '../profiles.js'
import {TtsSegmentsSchema} from '../schemas.js'

export const MIMO_TTS_BASE_URL = MIMO_PROVIDER_BASE_URL
export const MIMO_TTS_DEFAULT_VOICE = 'mimo_default'
export const MIMO_TTS_MODEL = MIMO_PROVIDER_MODEL_IDS.tts

const GENERIC_TTS_VOICE_HINTS = new Set([
  'female',
  'girl',
  'male',
  'man',
  'narrator',
  'neutral',
  'voice',
  'woman',
])

export class LLMTTSProvider implements TTSProvider {
  constructor(private readonly llm: LLMClient) {}

  async synthesize(segments: {duration?: number; id: string; text?: string}[]): Promise<TTSSegment[]> {
    const result = await this.llm.generateObject({
      messages: [
        {
          content: JSON.stringify({
            goal: 'Create TTS segment manifest JSON. Return only data matching the schema.',
            instructions: [
              'Return one TTS output entry for each narration segment.',
              'Preserve narration ids exactly as narrationId.',
              'Use stable relative wav paths under llm-tts/.',
              'Use the requested segment duration when provided; otherwise estimate a non-negative duration from text length.',
            ],
            segments,
          }),
          role: 'user',
        },
      ],
      schema: TtsSegmentsSchema,
      temperature: 0.1,
    })

    return attachProviderMetadata(TtsSegmentsSchema.parse(result.object), {
      usage: result.usage,
    })
  }
}

export interface MimoTTSProviderOptions {
  apiKey: string
  baseURL?: string
  fetch?: typeof fetch
  maxRetries?: number
  retryBackoffMs?: number
  model?: string
  style?: string
  voice?: string
}

interface MimoTTSRequestMetadata {
  inputCharacters: number
  requestId?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
}

export class MimoTTSProvider implements TTSProvider {
  private readonly baseURL: string
  private readonly fetch: typeof fetch
  private readonly maxRetries: number
  private readonly model: string
  private readonly retryBackoffMs: number
  private readonly voice: string

  constructor(private readonly options: MimoTTSProviderOptions) {
    this.baseURL = normalizeBaseURL(options.baseURL ?? MIMO_TTS_BASE_URL)
    this.fetch = options.fetch ?? fetch
    this.maxRetries = normalizeRetryCount(options.maxRetries ?? 2)
    this.model = options.model ?? MIMO_TTS_MODEL
    this.retryBackoffMs = normalizeRetryDelay(options.retryBackoffMs ?? 250)
    this.voice = options.voice ?? MIMO_TTS_DEFAULT_VOICE
  }

  async synthesize(segments: NarrationSegment[], options: TTSProviderSynthesizeOptions = {}): Promise<TTSSegment[]> {
    const outputDir = normalizeOutputDir(options.outputDir)
    await mkdir(outputDir, {recursive: true})

    const results: Array<{metadata: MimoTTSRequestMetadata; segment: TTSSegment}> = []

    /* eslint-disable no-await-in-loop */
    for (const [index, segment] of segments.entries()) {
      results.push(await this.synthesizeSegment(segment, index, outputDir, options.pathPrefix))
    }
    /* eslint-enable no-await-in-loop */

    const ttsSegments = TtsSegmentsSchema.parse(results.map((result) => result.segment))
    const metadata = results.map((result) => result.metadata)
    const requestIds = metadata.flatMap((item) => (item.requestId === undefined ? [] : [item.requestId]))

    return attachProviderMetadata(ttsSegments, {
      model: this.model,
      ...(requestIds.length === 1 ? {requestId: requestIds[0]} : {}),
      usage: {
        audioSeconds: ttsSegments.reduce((duration, segment) => duration + segment.duration, 0),
        inputCharacters: metadata.reduce((count, item) => count + item.inputCharacters, 0),
        inputTokens: metadata.reduce((count, item) => count + (item.usage?.inputTokens ?? 0), 0),
        outputTokens: metadata.reduce((count, item) => count + (item.usage?.outputTokens ?? 0), 0),
      },
    })
  }

  private async synthesizeSegment(segment: NarrationSegment, index: number, outputDir: string, pathPrefix: string | undefined): Promise<{metadata: MimoTTSRequestMetadata; segment: TTSSegment}> {
    const filename = `${String(index + 1).padStart(4, '0')}-${sanitizePathSegment(segment.id)}.wav`
    const outputPath = join(outputDir, filename)
    const relativePath = pathPrefix === undefined ? outputPath : posix.join(normalizePathPrefix(pathPrefix), filename)
    const response = await retryProviderRequest({
      backoffMs: this.retryBackoffMs,
      maxRetries: this.maxRetries,
      run: () => this.requestSegment(segment),
    })
    const audioData = readMimoTtsAudioData(response.json)

    await writeFile(outputPath, Buffer.from(audioData, 'base64'))
    const duration = await readGeneratedAudioDuration(outputPath, segment.duration ?? 0)

    return {
      metadata: {
        inputCharacters: segment.text.length,
        requestId: response.requestId ?? readStringField(response.json, 'id'),
        usage: readMimoTtsUsage(response.json),
      },
      segment: {
        duration,
        narrationId: segment.id,
        path: relativePath,
      },
    }
  }

  private async requestSegment(segment: NarrationSegment): Promise<{json: unknown; requestId?: string}> {
    let response: Response

    try {
      response = await this.fetch(`${this.baseURL}/chat/completions`, {
        body: JSON.stringify({
          audio: {
            format: 'wav',
            voice: resolveMimoTtsVoice(segment.voice, this.voice),
          },
          messages: [
            ...(this.options.style === undefined
              ? []
              : [
                  {
                    content: this.options.style,
                    role: 'user',
                  },
                ]),
            {
              content: segment.text,
              role: 'assistant',
            },
          ],
          model: this.model,
        }),
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.options.apiKey,
        },
        method: 'POST',
      })
    } catch (error) {
      throw new ProviderExecutionError({
        cause: error,
        code: 'mimo_tts_network_error',
        message: `MiMo TTS request failed before receiving a response: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
        role: 'tts',
      })
    }

    return readJsonResponse(response)
  }
}

async function readGeneratedAudioDuration(path: string, fallback: number): Promise<number> {
  try {
    const mediaInfo = await probeMedia(path)

    return mediaInfo.duration ?? fallback
  } catch {
    return fallback
  }
}

async function readJsonResponse(response: Response): Promise<{json: unknown; requestId?: string}> {
  const text = await response.text()
  const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined

  if (!response.ok) {
    throw new ProviderExecutionError({
      code: 'mimo_tts_http_error',
      details: {
        ...(requestId === undefined ? {} : {requestId}),
        responseBody: summarizeDiagnosticString(text),
        status: response.status,
        statusText: response.statusText,
      },
      message: `MiMo TTS request failed with HTTP ${response.status}.`,
      retryable: isRetryableHttpStatus(response.status),
      role: 'tts',
    })
  }

  try {
    return {
      json: JSON.parse(text) as unknown,
      ...(requestId === undefined ? {} : {requestId}),
    }
  } catch (error) {
    throw new ProviderExecutionError({
      cause: error,
      code: 'mimo_tts_invalid_json',
      details: {
        ...(requestId === undefined ? {} : {requestId}),
        responseBody: summarizeDiagnosticString(text),
      },
      message: `MiMo TTS response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      role: 'tts',
    })
  }
}

function readMimoTtsAudioData(response: unknown): string {
  const choices = isRecord(response) && Array.isArray(response.choices) ? response.choices : undefined
  const firstChoice = choices?.[0]
  const message = isRecord(firstChoice) ? firstChoice.message : undefined
  const audio = isRecord(message) ? message.audio : undefined
  const data = isRecord(audio) ? audio.data : undefined

  if (typeof data !== 'string' || data.trim() === '') {
    throw new Error('MiMo TTS response did not include choices[0].message.audio.data.')
  }

  return data
}

function readMimoTtsUsage(response: unknown): MimoTTSRequestMetadata['usage'] | undefined {
  const usage = isRecord(response) ? response.usage : undefined

  if (!isRecord(usage)) {
    return undefined
  }

  return {
    ...(typeof usage.prompt_tokens === 'number' && Number.isFinite(usage.prompt_tokens) ? {inputTokens: usage.prompt_tokens} : {}),
    ...(typeof usage.completion_tokens === 'number' && Number.isFinite(usage.completion_tokens) ? {outputTokens: usage.completion_tokens} : {}),
  }
}

function resolveMimoTtsVoice(segmentVoice: string | undefined, fallback: string): string {
  const voice = normalizeOptionalString(segmentVoice)

  if (voice === undefined || GENERIC_TTS_VOICE_HINTS.has(voice.toLowerCase())) {
    return fallback
  }

  return voice
}

async function retryProviderRequest<T>(input: {
  backoffMs: number
  maxRetries: number
  run: () => Promise<T>
}): Promise<T> {
  let attempt = 0

  /* eslint-disable no-await-in-loop */
  for (;;) {
    try {
      return await input.run()
    } catch (error) {
      if (!isRetryableProviderError(error) || attempt >= input.maxRetries) {
        throw error
      }

      attempt += 1

      if (input.backoffMs > 0) {
        await sleep(input.backoffMs * attempt)
      }
    }
  }
  /* eslint-enable no-await-in-loop */
}

function isRetryableProviderError(error: unknown): boolean {
  return error instanceof ProviderExecutionError && error.retryable
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

function normalizeRetryCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function normalizeRetryDelay(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
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
