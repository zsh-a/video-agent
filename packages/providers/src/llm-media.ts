import type {LLMClient} from '@video-agent/llm'

import {readFile} from 'node:fs/promises'
import {extname} from 'node:path'

import type {ASRProvider, MediaInput, SceneFrameBatch, Transcript, TTSProvider, TTSSegment, VLMProvider, VLMScene} from './contracts.js'

import {attachProviderMetadata} from './metadata.js'
import {TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from './schemas.js'

export const MIMO_ASR_MODEL = 'mimo-v2.5-asr'
export const MIMO_ASR_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1'

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
    const audio = await readFile(input.path)
    const result = await this.llm.generateText({
      messages: [
        {
          content: [
            {
              data: audio,
              mediaType: resolveAudioMimeType(input),
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

function inferLanguage(text: string): string | undefined {
  return /[\u3400-\u9FFF]/.test(text) ? 'zh-CN' : undefined
}
