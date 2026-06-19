import type {LLMClient, LLMUsage} from '@video-agent/llm'

import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ASRProvider, MediaInput, Transcript} from './contracts.js'

import {runFfmpeg} from '@video-agent/media'
import {bunFile} from './bun-runtime.js'
import {attachProviderMetadata} from './metadata.js'
import {createAudioDataUri, inferLanguage, mergeLLMUsage, normalizePositiveFiniteNumber, parseOptionalJson, resolveAudioMimeType, roundTimestamp} from './llm-media-utils.js'
import {MIMO_PROVIDER_BASE_URL, MIMO_PROVIDER_MODEL_IDS} from './profiles.js'
import {TranscriptSchema} from './schemas.js'

export const MIMO_ASR_MODEL = MIMO_PROVIDER_MODEL_IDS.asr
export const MIMO_ASR_BASE_URL = MIMO_PROVIDER_BASE_URL
export const MIMO_ASR_DEFAULT_SEGMENT_SECONDS = 30

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
              'If speech cannot be identified from the available evidence, return an empty transcript with no segments instead of inventing speech.',
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
