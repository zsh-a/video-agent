import type {LLMClient, LLMMessage, LLMUsage} from '@video-agent/llm'

import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {z} from 'zod'

import type {ASRProvider, MediaInput, Transcript} from '../contracts.js'

import {runFfmpeg} from '@video-agent/media'
import {attachProviderMetadata} from '../metadata.js'
import {createProviderObjectPromptRequest} from '../prompt.js'
import {PROVIDER_PROMPT_ASR_LANGUAGE_STAGE, PROVIDER_PROMPT_ASR_TRANSCRIPT_STAGE} from '../prompt-stages.js'
import {createAudioDataUri, mergeLLMUsage, normalizePositiveFiniteNumber, resolveAudioMimeType, roundTimestamp} from './media-utils.js'
import {MIMO_PROVIDER_BASE_URL, MIMO_PROVIDER_MODEL_IDS} from '../profiles.js'
import {TranscriptSchema} from '../schemas.js'

export const MIMO_ASR_MODEL = MIMO_PROVIDER_MODEL_IDS.asr
export const MIMO_ASR_BASE_URL = MIMO_PROVIDER_BASE_URL
export const MIMO_ASR_DEFAULT_SEGMENT_SECONDS = 30
const MimoTranscriptLanguageSchema = z.object({
  language: z.string().min(1),
})

export class LLMASRProvider implements ASRProvider {
  constructor(private readonly llm: LLMClient) {}

  async transcribe(input: MediaInput): Promise<Transcript> {
    const audio = await readFile(input.path)
    const mediaType = resolveAudioMimeType(input)
    const result = await this.llm.generateObject(createProviderObjectPromptRequest({
      buildMessages: () => createLLMAsrMessages(input, audio, mediaType),
      id: 'llm.asr.transcript',
      promptInput: {
        duration: input.duration,
        mimeType: mediaType,
        path: input.path,
      },
      schema: TranscriptSchema,
      schemaName: 'Transcript',
      stage: PROVIDER_PROMPT_ASR_TRANSCRIPT_STAGE,
      temperature: 0.1,
    }))
    const transcript = normalizeLLMAsrTranscript(TranscriptSchema.parse(result.object))

    return attachProviderMetadata(transcript, {
      usage: result.usage,
    })
  }
}

function createLLMAsrMessages(input: MediaInput, audio: Uint8Array, mediaType: string): LLMMessage[] {
  return [
    {
      content: [
        {
          text: JSON.stringify({
            duration: input.duration,
            goal: 'Transcribe the attached audio into timestamped transcript JSON. Return only data matching the schema.',
            instructions: [
              'Use the attached audio file as the only speech evidence.',
              'Do not infer, summarize, or invent transcript text from the file path, metadata, or surrounding context.',
              'Return exact timestampConfidence only when every non-empty segment has a positive start/end range in seconds.',
              'If speech cannot be identified from the attached audio, return empty text, empty segments, and timestampConfidence exact.',
            ],
            path: input.path,
          }),
          type: 'text' as const,
        },
        {
          data: createAudioDataUri(audio, mediaType),
          mediaType,
          type: 'file' as const,
        },
      ],
      role: 'user',
    },
  ]
}

function normalizeLLMAsrTranscript(transcript: Transcript): Transcript {
  assertTranscriptTextDoesNotNeedCleanup(transcript, 'LLM ASR transcript')
  assertTranscriptSegmentsDoNotNeedCleanup(transcript, 'LLM ASR transcript')
  requireExplicitTranscriptText(transcript, 'LLM ASR transcript')
  requireConcreteTranscriptLanguage(transcript, 'LLM ASR transcript')

  if (transcript.text.trim() !== '') {
    const invalidSegment = transcript.segments.find((segment) => segment.text.trim() !== '' && segment.end <= segment.start)

    if (invalidSegment !== undefined || transcript.segments.every((segment) => segment.text.trim() === '')) {
      throw new Error('LLM ASR transcript text requires non-empty timed segments with positive timestamp ranges.')
    }
  }

  return transcript
}

export class MimoASRProvider implements ASRProvider {
  constructor(
    private readonly llm: LLMClient,
    private readonly options: MimoASRProviderOptions = {},
  ) {}

  async transcribe(input: MediaInput): Promise<Transcript> {
    const segmentLength = requireMimoAsrSegmentLength(this.options.segmentLengthSeconds)
    const duration = normalizePositiveFiniteNumber(input.duration)

    if (duration !== undefined && duration > segmentLength) {
      return this.transcribeSegmented(input, duration, segmentLength)
    }

    const result = await this.transcribeAudioPath(input)
    const parsed = await parseTranscriptFromMimoContent(this.llm, result.text, {
      windowEnd: duration,
      windowStart: 0,
    })

    return attachProviderMetadata(parsed.transcript, {
      model: MIMO_ASR_MODEL,
      usage: mergeLLMUsage([result.usage, parsed.usage].filter((usage): usage is LLMUsage => usage !== undefined)),
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
        } catch (error) {
          throw new Error(`MiMo ASR failed to prepare audio segment ${index + 1} (${window.start}-${window.end}s): ${formatErrorMessage(error)}`)
        }

        const result = await this.transcribeAudioPath({
          duration: window.end - window.start,
          mimeType: 'audio/wav',
          path: chunkPath,
        })

        if (result.usage !== undefined) {
          usages.push(result.usage)
        }

        const parsed = await parseTranscriptFromMimoContent(this.llm, result.text, {
          windowEnd: window.end,
          windowStart: window.start,
        })

        if (parsed.usage !== undefined) {
          usages.push(parsed.usage)
        }

        chunks.push(parsed.transcript)
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
    const audio = await readFile(input.path)
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

function requireMimoAsrSegmentLength(value: number | undefined): number {
  if (value === undefined) {
    return MIMO_ASR_DEFAULT_SEGMENT_SECONDS
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`MiMo ASR segmentLengthSeconds must be a positive finite number; no segment length default fallback is allowed. Received: ${String(value)}`)
  }

  return value
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

function mergeWindowTranscripts(transcripts: Transcript[]): Transcript {
  const segments = transcripts.flatMap((transcript) => transcript.segments)
  const text = transcripts.map((transcript, index) => {
    assertTranscriptTextDoesNotNeedCleanup(transcript, `MiMo ASR transcript chunk ${index + 1}`)
    assertTranscriptSegmentsDoNotNeedCleanup(transcript, `MiMo ASR transcript chunk ${index + 1}`)

    return transcript.text
  }).filter((chunkText) => chunkText !== '').join('\n')
  const languages = uniqueTranscriptLanguages(transcripts)
  const language = languages[0]

  if (languages.length > 1) {
    throw new Error(`MiMo ASR segmented transcript returned conflicting languages (${languages.join(', ')}); no merged transcript language fallback is allowed.`)
  }

  if (text !== '' && language === undefined) {
    throw new Error('MiMo ASR segmented transcript contains text but no explicit language; no merged transcript language fallback is allowed.')
  }

  return TranscriptSchema.parse({
    ...(language === undefined ? {} : {language}),
    segments,
    text,
    timestampConfidence: 'exact',
  })
}

function uniqueTranscriptLanguages(transcripts: Transcript[]): string[] {
  return [...new Set(transcripts.flatMap((transcript) => {
    const language = transcript.language?.trim()

    return language === undefined || language === '' ? [] : [language]
  }))]
}

async function parseTranscriptFromMimoContent(
  llm: LLMClient,
  content: string,
  options: {
    windowEnd?: number
    windowStart: number
  },
): Promise<{transcript: Transcript; usage?: LLMUsage}> {
  const trimmed = content.trim()
  const transcript = parseMimoTranscriptJson(trimmed)

  return ensureTranscriptLanguage(llm, normalizeParsedMimoTranscript(transcript, options))
}

function parseMimoTranscriptJson(content: string): Transcript {
  let parsed: unknown

  try {
    parsed = JSON.parse(content) as unknown
  } catch (error) {
    throw new Error(`MiMo ASR response was not valid transcript JSON; provider must return only JSON with timed segments. ${formatErrorMessage(error)}`)
  }

  const result = TranscriptSchema.safeParse(parsed)

  if (!result.success) {
    throw new Error(`MiMo ASR transcript JSON failed schema validation. ${formatZodIssues(result.error.issues)}`)
  }

  return result.data
}

function normalizeParsedMimoTranscript(
  transcript: Transcript,
  options: {
    windowEnd?: number
    windowStart: number
  },
): Transcript {
  assertTranscriptTextDoesNotNeedCleanup(transcript, 'MiMo ASR transcript JSON')

  if (transcript.segments.length === 0) {
    if (transcript.text.trim() !== '') {
      throw new Error('MiMo ASR transcript JSON contains text but no timed segments; no default timing fallback is allowed.')
    }

    return TranscriptSchema.parse({
      ...transcript,
      timestampConfidence: 'exact',
    })
  }

  requireExplicitTranscriptText(transcript, 'MiMo ASR transcript JSON')
  assertTranscriptSegmentsDoNotNeedCleanup(transcript, 'MiMo ASR transcript JSON')
  assertTimedTranscriptSegments(transcript)
  assertTranscriptSegmentsWithinWindow(transcript, options)
  validateOptionalTranscriptLanguage(transcript, 'MiMo ASR transcript JSON')

  const offset = options.windowStart

  return TranscriptSchema.parse({
    ...transcript,
    segments: transcript.segments.map((segment) => ({
      ...segment,
      end: roundTimestamp(segment.end + offset),
      start: roundTimestamp(segment.start + offset),
    })),
    timestampConfidence: 'exact',
  })
}

function assertTimedTranscriptSegments(transcript: Transcript): void {
  const invalidSegment = transcript.segments.find((segment) => segment.text.trim() !== '' && segment.end <= segment.start)

  if (invalidSegment !== undefined) {
    throw new Error('MiMo ASR transcript JSON contains non-empty segments without positive timestamp ranges.')
  }
}

function assertTranscriptSegmentsWithinWindow(
  transcript: Transcript,
  options: {
    windowEnd?: number
    windowStart: number
  },
): void {
  if (options.windowEnd === undefined) {
    return
  }

  const windowDuration = options.windowEnd - options.windowStart
  const outOfWindowSegment = transcript.segments.find((segment) => segment.start < -0.001 || segment.end > windowDuration + 0.001)

  if (outOfWindowSegment !== undefined) {
    throw new Error('MiMo ASR transcript JSON timestamps must be relative to the requested audio window; no absolute/global timestamp fallback is allowed.')
  }
}

function requireExplicitTranscriptText(transcript: Transcript, context: string): void {
  if (transcript.segments.length === 0) {
    return
  }

  if (transcript.text.trim() === '') {
    throw new Error(`${context} must include explicit transcript text when timed segments are present; no segment-text transcript reconstruction fallback is allowed.`)
  }
}

function assertTranscriptTextDoesNotNeedCleanup(transcript: Transcript, context: string): void {
  if (transcript.text !== transcript.text.trim()) {
    throw new Error(`${context} text contains leading or trailing whitespace; no runtime transcript text trim is allowed.`)
  }
}

function assertTranscriptSegmentsDoNotNeedCleanup(transcript: Transcript, context: string): void {
  const dirtySegmentIndex = transcript.segments.findIndex((segment) => segment.text !== segment.text.trim())

  if (dirtySegmentIndex >= 0) {
    throw new Error(`${context} segment ${dirtySegmentIndex + 1} text contains leading or trailing whitespace; no runtime transcript segment text trim is allowed.`)
  }
}

async function ensureTranscriptLanguage(llm: LLMClient, transcript: Transcript): Promise<{transcript: Transcript; usage?: LLMUsage}> {
  if (transcript.language !== undefined || transcriptText(transcript) === '') {
    validateOptionalTranscriptLanguage(transcript, 'MiMo ASR transcript JSON')

    return {transcript}
  }

  const result = await llm.generateObject(createProviderObjectPromptRequest({
    buildMessages: (promptInput) => [
      {
        content: JSON.stringify({
          goal: 'Identify the BCP-47 language tag for the ASR transcript text. Return only data matching the schema.',
          instructions: [
            'Use the transcript text itself as evidence.',
            'Return a concrete language tag such as zh-CN, en-US, ja-JP, or ko-KR.',
            'Do not return auto, unknown, or an empty value.',
          ],
          transcript: promptInput.transcriptText,
        }),
        role: 'user',
      },
    ],
    id: 'mimo.asr.language',
    promptInput: {
      transcriptText: transcriptText(transcript),
    },
    schema: MimoTranscriptLanguageSchema,
    schemaName: 'MimoTranscriptLanguage',
    stage: PROVIDER_PROMPT_ASR_LANGUAGE_STAGE,
    temperature: 0,
  }))

  return {
    transcript: TranscriptSchema.parse({
      ...transcript,
      language: requireConcreteLanguageTag(result.object.language, 'MiMo ASR transcript language detector'),
    }),
    usage: result.usage,
  }
}

function requireConcreteTranscriptLanguage(transcript: Transcript, context: string): void {
  if (transcriptText(transcript) === '') {
    return
  }

  if (transcript.language === undefined) {
    throw new Error(`${context} with transcript text must include a concrete language tag; no language default fallback is allowed.`)
  }

  requireConcreteLanguageTag(transcript.language, context)
}

function validateOptionalTranscriptLanguage(transcript: Transcript, context: string): void {
  if (transcript.language === undefined) {
    return
  }

  requireConcreteLanguageTag(transcript.language, context)
}

function requireConcreteLanguageTag(language: string, context: string): string {
  if (language !== language.trim()) {
    throw new Error(`${context} language contains leading or trailing whitespace; no runtime language trim is allowed.`)
  }

  if (/[\r\n\t]/u.test(language) || /[^\S\r\n]{2,}/u.test(language)) {
    throw new Error(`${context} language contains layout whitespace; no runtime language repair is allowed.`)
  }

  if (language === '') {
    throw new Error(`${context} language is empty; no language default fallback is allowed.`)
  }

  if (['auto', 'unknown', 'und', 'undefined'].includes(language.toLowerCase())) {
    throw new Error(`${context} language "${language}" is not a concrete language tag; no language default fallback is allowed.`)
  }

  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(language)) {
    throw new Error(`${context} language "${language}" is not a valid concrete BCP-47 language tag.`)
  }

  return language
}

function transcriptText(transcript: Transcript): string {
  return transcript.text
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`).join('; ')
}
