import type {LLMClient} from '@video-agent/llm'

import {mkdir, writeFile} from 'node:fs/promises'
import {extname, join, posix} from 'node:path'

import type {NarrationSegment} from '@video-agent/ir'
import type {ASRProvider, MediaInput, SceneFrameBatch, Transcript, TTSProvider, TTSProviderSynthesizeOptions, TTSSegment, VLMProvider, VLMScene} from './contracts.js'

import {bunFile} from './bun-runtime.js'
import {attachProviderMetadata} from './metadata.js'
import {MIMO_PROVIDER_BASE_URL} from './profiles.js'
import {TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from './schemas.js'

export const MIMO_ASR_MODEL = 'mimo-v2.5-asr'
export const MIMO_ASR_BASE_URL = MIMO_PROVIDER_BASE_URL
export const MIMO_TTS_BASE_URL = MIMO_PROVIDER_BASE_URL
export const MIMO_TTS_DEFAULT_VOICE = 'mimo_default'
export const MIMO_TTS_MODEL = 'mimo-v2.5-tts'

export class LLMASRProvider implements ASRProvider {
  constructor(private readonly llm: LLMClient) {}

  async transcribe(input: MediaInput): Promise<Transcript> {
    const result = await this.llm.generateObject({
      messages: [
        {
          content: JSON.stringify({
            goal: 'Create transcript JSON for the provided media input. Return only data matching the schema.',
            input,
            instructions: [
              'Infer a concise transcript from available media metadata or path context.',
              'Use seconds for segment start and end values.',
              'If exact speech is unavailable, return a minimal faithful placeholder that clearly references the input.',
            ],
          }),
          role: 'user',
        },
      ],
      schema: TranscriptSchema,
      temperature: 0.1,
    })

    return attachProviderMetadata(TranscriptSchema.parse(result.object), {
      usage: result.usage,
    })
  }
}

export class MimoASRProvider implements ASRProvider {
  constructor(private readonly llm: LLMClient) {}

  async transcribe(input: MediaInput): Promise<Transcript> {
    const audio = await bunFile(input.path).bytes()
    const mediaType = resolveAudioMimeType(input)
    const result = await this.llm.generateText({
      messages: [
        {
          content: [
            {
              data: createAudioDataUri(audio, mediaType),
              mediaType,
              type: 'file',
            },
          ],
          role: 'user',
        },
      ],
      providerOptions: {
        mimo: {
          'asr_options': {
            language: 'auto',
          },
        },
      },
    })
    const transcript = parseTranscriptFromMimoContent(result.text)

    return attachProviderMetadata(transcript, {
      model: MIMO_ASR_MODEL,
      usage: result.usage,
    })
  }
}

export class LLMVLMProvider implements VLMProvider {
  constructor(private readonly llm: LLMClient) {}

  async analyzeScenes(input: SceneFrameBatch[], context?: string): Promise<VLMScene[]> {
    const result = await this.llm.generateObject({
      messages: [
        {
          content: JSON.stringify({
            context,
            goal: 'Create visual scene analysis JSON. Return only data matching the schema.',
            instructions: [
              'Return one scene entry for each input batch.',
              'Preserve sceneId values exactly.',
              'Use frame paths as evidence when they support the description.',
            ],
            sceneBatches: input,
          }),
          role: 'user',
        },
      ],
      schema: VlmScenesSchema,
      temperature: 0.2,
    })

    return attachProviderMetadata(VlmScenesSchema.parse(result.object), {
      usage: result.usage,
    })
  }
}

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
  private readonly model: string
  private readonly voice: string

  constructor(private readonly options: MimoTTSProviderOptions) {
    this.baseURL = normalizeBaseURL(options.baseURL ?? MIMO_TTS_BASE_URL)
    this.fetch = options.fetch ?? fetch
    this.model = options.model ?? MIMO_TTS_MODEL
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
    const response = await this.fetch(`${this.baseURL}/chat/completions`, {
      body: JSON.stringify({
        audio: {
          format: 'wav',
          voice: normalizeOptionalString(segment.voice) ?? this.voice,
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

    const responseJson = await readJsonResponse(response)
    const audioData = readMimoTtsAudioData(responseJson)

    await writeFile(outputPath, Buffer.from(audioData, 'base64'))

    return {
      metadata: {
        inputCharacters: segment.text.length,
        requestId: response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? readStringField(responseJson, 'id'),
        usage: readMimoTtsUsage(responseJson),
      },
      segment: {
        duration: segment.duration ?? 0,
        narrationId: segment.id,
        path: relativePath,
      },
    }
  }
}

function parseTranscriptFromMimoContent(content: string): Transcript {
  const trimmed = content.trim()
  const parsed = parseOptionalJson(trimmed)

  if (parsed !== undefined) {
    return TranscriptSchema.parse(parsed)
  }

  return TranscriptSchema.parse({
    language: inferLanguage(trimmed),
    segments: trimmed === ''
      ? []
      : [
          {
            end: 0,
            start: 0,
            text: trimmed,
          },
        ],
    text: trimmed,
  })
}

function parseOptionalJson(text: string): undefined | unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)

    if (fenced?.[1] !== undefined) {
      return JSON.parse(fenced[1]) as unknown
    }

    const objectStart = text.indexOf('{')
    const objectEnd = text.lastIndexOf('}')

    if (objectStart !== -1 && objectEnd > objectStart) {
      return JSON.parse(text.slice(objectStart, objectEnd + 1)) as unknown
    }

    return undefined
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()

  if (!response.ok) {
    throw new Error(`MiMo TTS request failed with HTTP ${response.status}: ${text.slice(0, 500)}`)
  }

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`MiMo TTS response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
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

function readStringField(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const item = value[field]

  return typeof item === 'string' && item.trim() !== '' ? item : undefined
}

function resolveAudioMimeType(input: MediaInput): string {
  if (input.mimeType !== undefined && input.mimeType.trim() !== '') {
    return input.mimeType
  }

  const ext = extname(input.path).toLowerCase().slice(1)
  const mimeTypes: Record<string, string> = {
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    mp4: 'audio/mp4',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    webm: 'audio/webm',
  }
  const mimeType = mimeTypes[ext]

  if (mimeType !== undefined) {
    return mimeType
  }

  return 'audio/wav'
}

function normalizeBaseURL(value: string): string {
  const trimmed = value.trim()

  if (trimmed === '') {
    throw new Error('MiMo TTS baseURL must be configured.')
  }

  return trimmed.replaceAll(/\/+$/g, '')
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim()
}

function normalizeOutputDir(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error('MiMo TTS requires an outputDir so generated audio can be written to the project workspace.')
  }

  return value
}

function normalizePathPrefix(value: string): string {
  return value.replaceAll(/\\/g, '/').replaceAll(/^\/+|\/+$/g, '')
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

  return sanitized === '' ? 'segment' : sanitized
}

function createAudioDataUri(audio: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${Buffer.from(audio).toString('base64')}`
}

function inferLanguage(text: string): string | undefined {
  return /[\u3400-\u9FFF]/.test(text) ? 'zh-CN' : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
