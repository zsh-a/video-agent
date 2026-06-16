import type {LLMClient, LLMMessage, LLMUsage} from '@video-agent/llm'

import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {extname, join, posix} from 'node:path'

import type {NarrationSegment} from '@video-agent/ir'
import type {ASRProvider, MediaInput, SceneFrameBatch, Transcript, TTSProvider, TTSProviderSynthesizeOptions, TTSSegment, VLMProvider, VLMScene} from './contracts.js'

import {probeMedia, runFfmpeg} from '@video-agent/media'
import {bunFile} from './bun-runtime.js'
import {attachProviderMetadata} from './metadata.js'
import {MIMO_PROVIDER_BASE_URL, MIMO_PROVIDER_MODEL_IDS} from './profiles.js'
import {TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from './schemas.js'

export const MIMO_ASR_MODEL = MIMO_PROVIDER_MODEL_IDS.asr
export const MIMO_ASR_BASE_URL = MIMO_PROVIDER_BASE_URL
export const MIMO_TTS_BASE_URL = MIMO_PROVIDER_BASE_URL
export const MIMO_TTS_DEFAULT_VOICE = 'mimo_default'
export const MIMO_TTS_MODEL = MIMO_PROVIDER_MODEL_IDS.tts
export const MIMO_ASR_DEFAULT_SEGMENT_SECONDS = 30
const MAX_VLM_IMAGE_PARTS = 16
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
  constructor(
    private readonly llm: LLMClient,
    private readonly options: MimoASRProviderOptions = {},
  ) {}

  async transcribe(input: MediaInput): Promise<Transcript> {
    const duration = normalizePositiveFiniteNumber(input.duration)
    const segmentLength = normalizePositiveFiniteNumber(this.options.segmentLengthSeconds) ?? MIMO_ASR_DEFAULT_SEGMENT_SECONDS

    if (duration !== undefined && duration > segmentLength) {
      return this.transcribeSegmented(input, duration, segmentLength)
    }

    const result = await this.transcribeAudioPath(input)
    const transcript = parseTranscriptFromMimoContent(result.text, {
      fallbackEnd: duration ?? 0,
      fallbackStart: 0,
      timestampConfidence: duration === undefined ? 'untimed' : 'chunked',
    })

    return attachProviderMetadata(transcript, {
      model: MIMO_ASR_MODEL,
      usage: result.usage,
    })
  }

  private async transcribeSegmented(input: MediaInput, duration: number, segmentLength: number): Promise<Transcript> {
    const windows = createMimoAsrWindows(duration, segmentLength)
    const tempDir = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-'))
    const chunks: Transcript[] = []
    const usages: LLMUsage[] = []

    try {
      /* eslint-disable no-await-in-loop */
      for (const [index, window] of windows.entries()) {
        const chunkPath = join(tempDir, `seg_${String(index + 1).padStart(4, '0')}.wav`)

        try {
          await (this.options.segmentAudio ?? sliceMimoAsrAudio)(input.path, chunkPath, window)
        } catch {
          chunks.push(createEmptyWindowTranscript(window))
          continue
        }

        const result = await this.transcribeAudioPath({
          duration: window.end - window.start,
          mimeType: 'audio/wav',
          path: chunkPath,
        })

        if (result.usage !== undefined) {
          usages.push(result.usage)
        }

        chunks.push(parseTranscriptFromMimoContent(result.text, {
          fallbackEnd: window.end,
          fallbackStart: window.start,
          timestampConfidence: 'chunked',
        }))
      }
      /* eslint-enable no-await-in-loop */
    } finally {
      await rm(tempDir, {force: true, recursive: true})
    }

    return attachProviderMetadata(mergeWindowTranscripts(chunks), {
      model: MIMO_ASR_MODEL,
      usage: mergeLLMUsage(usages),
    })
  }

  private async transcribeAudioPath(input: MediaInput): Promise<{text: string; usage?: LLMUsage}> {
    const audio = await bunFile(input.path).bytes()
    const mediaType = resolveAudioMimeType(input)

    return this.llm.generateText({
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
  }
}

export interface MimoASRProviderOptions {
  segmentAudio?: MimoAsrAudioSegmenter
  segmentLengthSeconds?: number
}

export interface MimoAsrWindow {
  end: number
  start: number
}

export type MimoAsrAudioSegmenter = (inputPath: string, outputPath: string, window: MimoAsrWindow) => Promise<void>

export class LLMVLMProvider implements VLMProvider {
  constructor(private readonly llm: LLMClient) {}

  async analyzeScenes(input: SceneFrameBatch[], context?: string): Promise<VLMScene[]> {
    const result = await this.llm.generateObject({
      messages: await createVlmMessages(input, context),
      schema: VlmScenesSchema,
      temperature: 0.2,
    })

    return attachProviderMetadata(VlmScenesSchema.parse(result.object), {
      usage: result.usage,
    })
  }
}

async function createVlmMessages(input: SceneFrameBatch[], context?: string): Promise<LLMMessage[]> {
  const sampledFramePaths = sampleVlmFramePaths(input)
  const imageParts = await Promise.all(sampledFramePaths.map(async (path) => createVlmImagePart(path)))
  const content = [
    {
      text: JSON.stringify({
        context,
        goal: 'Create visual scene analysis JSON. Return only data matching the schema.',
        instructions: [
          'Return one scene entry for each input batch.',
          'Preserve sceneId values exactly.',
          'Use attached images and frame paths as evidence when they support the description.',
          'Use seconds for time ranges and do not invent scene ids.',
        ],
        sampledFrames: sampledFramePaths,
        sceneBatches: input,
      }),
      type: 'text' as const,
    },
    ...imageParts.filter((part): part is NonNullable<typeof part> => part !== undefined),
  ]

  return [
    {
      content,
      role: 'user',
    },
  ] as LLMMessage[]
}

function sampleVlmFramePaths(input: SceneFrameBatch[]): string[] {
  const allFramePaths = Array.from(new Set(input.flatMap((batch) => batch.frames)))

  if (allFramePaths.length <= MAX_VLM_IMAGE_PARTS) {
    return allFramePaths
  }

  const representativePaths = sampleEvenly(
    input
      .map((batch) => batch.frames[0])
      .filter((path): path is string => path !== undefined),
    MAX_VLM_IMAGE_PARTS,
  )
  const selected = new Set(representativePaths)

  if (selected.size < MAX_VLM_IMAGE_PARTS) {
    for (const path of sampleEvenly(allFramePaths, MAX_VLM_IMAGE_PARTS)) {
      selected.add(path)

      if (selected.size >= MAX_VLM_IMAGE_PARTS) {
        break
      }
    }
  }

  return [...selected]
}

function sampleEvenly<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) {
    return values
  }

  if (limit === 1) {
    const first = values[0]

    return first === undefined ? [] : [first]
  }

  const lastIndex = values.length - 1

  return Array.from({length: limit}, (_, index) => values[Math.round((index * lastIndex) / (limit - 1))])
    .filter((value): value is T => value !== undefined)
}

async function createVlmImagePart(path: string): Promise<{data: string; filename: string; mediaType: string; type: 'file'} | undefined> {
  try {
    const image = await bunFile(path).bytes()
    const mediaType = resolveImageMimeType(path)

    return {
      data: createFileDataUri(image, mediaType),
      filename: posix.basename(path),
      mediaType,
      type: 'file',
    }
  } catch {
    return undefined
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

    const responseJson = await readJsonResponse(response)
    const audioData = readMimoTtsAudioData(responseJson)

    await writeFile(outputPath, Buffer.from(audioData, 'base64'))
    const duration = await readGeneratedAudioDuration(outputPath, segment.duration ?? 0)

    return {
      metadata: {
        inputCharacters: segment.text.length,
        requestId: response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? readStringField(responseJson, 'id'),
        usage: readMimoTtsUsage(responseJson),
      },
      segment: {
        duration,
        narrationId: segment.id,
        path: relativePath,
      },
    }
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

function createMimoAsrWindows(duration: number, segmentLength: number): MimoAsrWindow[] {
  const windows: MimoAsrWindow[] = []
  let start = 0

  while (start < duration) {
    const end = Math.min(duration, start + segmentLength)

    windows.push({
      end: roundTimestamp(end),
      start: roundTimestamp(start),
    })
    start = end
  }

  return windows
}

async function sliceMimoAsrAudio(inputPath: string, outputPath: string, window: MimoAsrWindow): Promise<void> {
  await runFfmpeg([
    '-y',
    '-ss',
    String(window.start),
    '-i',
    inputPath,
    '-t',
    String(window.end - window.start),
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '24000',
    '-ac',
    '1',
    outputPath,
  ])
}

function createEmptyWindowTranscript(window: MimoAsrWindow): Transcript {
  return {
    segments: [
      {
        end: window.end,
        start: window.start,
        text: '',
      },
    ],
    text: '',
    timestampConfidence: 'chunked',
  }
}

function mergeWindowTranscripts(transcripts: Transcript[]): Transcript {
  const segments = transcripts.flatMap((transcript) => transcript.segments)
  const text = transcripts.map((transcript) => transcript.text.trim()).filter(Boolean).join('\n')
  const language = transcripts.find((transcript) => transcript.language !== undefined)?.language
  const timestampConfidence = transcripts.some((transcript) => transcript.timestampConfidence === 'untimed')
    ? 'untimed'
    : transcripts.some((transcript) => transcript.timestampConfidence === 'chunked')
      ? 'chunked'
      : 'exact'

  return TranscriptSchema.parse({
    ...(language === undefined ? {} : {language}),
    segments,
    text,
    timestampConfidence,
  })
}

function mergeLLMUsage(usages: LLMUsage[]): LLMUsage | undefined {
  if (usages.length === 0) {
    return undefined
  }

  const inputTokens = sumOptionalUsage(usages, 'inputTokens')
  const outputTokens = sumOptionalUsage(usages, 'outputTokens')
  const totalTokens = sumOptionalUsage(usages, 'totalTokens')
  const usage = {
    ...(inputTokens === undefined ? {} : {inputTokens}),
    ...(outputTokens === undefined ? {} : {outputTokens}),
    ...(totalTokens === undefined ? {} : {totalTokens}),
  }

  return Object.keys(usage).length === 0 ? undefined : usage
}

function normalizePositiveFiniteNumber(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? undefined : value
}

function roundTimestamp(value: number): number {
  return Math.round(value * 1000) / 1000
}

function sumOptionalUsage(usages: LLMUsage[], key: keyof LLMUsage): number | undefined {
  const values = usages.flatMap((usage) => (usage[key] === undefined ? [] : [usage[key]]))

  return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0)
}

function parseTranscriptFromMimoContent(
  content: string,
  options: {
    fallbackEnd: number
    fallbackStart: number
    timestampConfidence: NonNullable<Transcript['timestampConfidence']>
  },
): Transcript {
  const trimmed = content.trim()
  const parsed = parseOptionalJson(trimmed)

  if (parsed !== undefined) {
    return normalizeParsedMimoTranscript(TranscriptSchema.parse(parsed), options)
  }

  return TranscriptSchema.parse({
    language: inferLanguage(trimmed),
    segments: trimmed === ''
      ? []
      : [
          {
            end: options.fallbackEnd,
            start: options.fallbackStart,
            text: trimmed,
          },
        ],
    text: trimmed,
    timestampConfidence: options.timestampConfidence,
  })
}

function normalizeParsedMimoTranscript(
  transcript: Transcript,
  options: {
    fallbackEnd: number
    fallbackStart: number
    timestampConfidence: NonNullable<Transcript['timestampConfidence']>
  },
): Transcript {
  if (transcript.segments.length === 0) {
    return TranscriptSchema.parse({
      ...transcript,
      timestampConfidence: transcript.timestampConfidence ?? options.timestampConfidence,
    })
  }

  if (hasTimedTranscriptSegments(transcript)) {
    const offset = shouldOffsetParsedTranscript(transcript, options) ? options.fallbackStart : 0

    return TranscriptSchema.parse({
      ...transcript,
      segments: transcript.segments.map((segment) => ({
        ...segment,
        end: roundTimestamp(segment.end + offset),
        start: roundTimestamp(segment.start + offset),
      })),
      timestampConfidence: transcript.timestampConfidence ?? 'exact',
    })
  }

  return TranscriptSchema.parse({
    ...transcript,
    segments: [
      {
        end: options.fallbackEnd,
        start: options.fallbackStart,
        text: transcript.text,
      },
    ],
    timestampConfidence: transcript.timestampConfidence ?? options.timestampConfidence,
  })
}

function hasTimedTranscriptSegments(transcript: Transcript): boolean {
  return transcript.segments.some((segment) => segment.end > segment.start)
}

function shouldOffsetParsedTranscript(
  transcript: Transcript,
  options: {
    fallbackEnd: number
    fallbackStart: number
  },
): boolean {
  if (options.fallbackStart <= 0) {
    return false
  }

  const windowDuration = options.fallbackEnd - options.fallbackStart
  const maxEnd = Math.max(...transcript.segments.map((segment) => segment.end))

  return maxEnd <= windowDuration + 0.001
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

function resolveImageMimeType(path: string): string {
  const ext = extname(path).toLowerCase().slice(1)
  const mimeTypes: Record<string, string> = {
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }

  return mimeTypes[ext] ?? 'image/jpeg'
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

function resolveMimoTtsVoice(segmentVoice: string | undefined, fallback: string): string {
  const voice = normalizeOptionalString(segmentVoice)

  if (voice === undefined || GENERIC_TTS_VOICE_HINTS.has(voice.toLowerCase())) {
    return fallback
  }

  return voice
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
  return createFileDataUri(audio, mediaType)
}

function createFileDataUri(data: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${Buffer.from(data).toString('base64')}`
}

function inferLanguage(text: string): string | undefined {
  return /[\u3400-\u9FFF]/.test(text) ? 'zh-CN' : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
