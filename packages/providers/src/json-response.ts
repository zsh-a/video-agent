import type {ZodIssue} from 'zod'

import type {Transcript, TTSSegment, VLMScene} from './contracts.js'
import type {ProviderValidationIssue} from './errors.js'
import type {ProviderResponseMetadata} from './metadata.js'

import {ProviderResponseValidationError} from './errors.js'
import {attachProviderMetadata, parseProviderResponseMetadata} from './metadata.js'
import {TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from './schemas.js'

interface ProviderResponseEnvelope {
  data: unknown
  metadata?: ProviderResponseMetadata
}

export function parseTranscript(value: unknown): Transcript {
  const envelope = parseProviderResponseEnvelope(value, 'asr')

  value = envelope.data

  const transcript = TranscriptSchema.safeParse(value)

  if (!transcript.success) {
    throw createProviderValidationError('asr', 'ASR provider returned an invalid transcript.', transcript.error.issues)
  }

  return attachProviderMetadata(transcript.data, envelope.metadata)
}

export function parseVlmScenes(value: unknown): VLMScene[] {
  const envelope = parseProviderResponseEnvelope(value, 'vlm')

  value = envelope.data

  const scenes = VlmScenesSchema.safeParse(value)

  if (!scenes.success) {
    throw createProviderValidationError('vlm', 'VLM provider returned an invalid scene list.', scenes.error.issues)
  }

  return attachProviderMetadata(scenes.data, envelope.metadata)
}

export function parseTtsSegments(value: unknown): TTSSegment[] {
  const envelope = parseProviderResponseEnvelope(value, 'tts')

  value = envelope.data

  const segments = TtsSegmentsSchema.safeParse(value)

  if (!segments.success) {
    throw createProviderValidationError('tts', 'TTS provider returned an invalid segment list.', segments.error.issues)
  }

  return attachProviderMetadata(segments.data, envelope.metadata)
}

function parseProviderResponseEnvelope(value: unknown, role: 'asr' | 'tts' | 'vlm'): ProviderResponseEnvelope {
  if (!isRecord(value) || !('data' in value)) {
    return {data: value}
  }

  let metadata: ProviderResponseMetadata | undefined

  try {
    metadata = parseProviderResponseMetadata(value.metadata)
  } catch (error) {
    throw createProviderMetadataValidationError(role, error)
  }

  return {
    data: value.data,
    ...(metadata === undefined ? {} : {metadata}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createProviderValidationError(role: 'asr' | 'tts' | 'vlm', message: string, issues: ZodIssue[]): ProviderResponseValidationError {
  return new ProviderResponseValidationError(role, message, issues.map((issue): ProviderValidationIssue => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map(String),
  })))
}

function createProviderMetadataValidationError(role: 'asr' | 'tts' | 'vlm', error: unknown): ProviderResponseValidationError {
  return new ProviderResponseValidationError(role, `${role.toUpperCase()} provider returned invalid response metadata.`, [{
    code: 'invalid_metadata',
    message: error instanceof Error ? error.message : String(error),
    path: ['metadata'],
  }])
}
