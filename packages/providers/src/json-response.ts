import type {Transcript, TTSSegment, VLMScene} from './contracts.js'
import type {ProviderResponseMetadata} from './metadata.js'

import {attachProviderMetadata, parseProviderResponseMetadata} from './metadata.js'
import {TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from './schemas.js'

interface ProviderResponseEnvelope {
  data: unknown
  metadata?: ProviderResponseMetadata
}

export function parseTranscript(value: unknown): Transcript {
  const envelope = parseProviderResponseEnvelope(value)

  value = envelope.data

  const transcript = TranscriptSchema.safeParse(value)

  if (!transcript.success) {
    throw new TypeError('ASR provider returned an invalid transcript.')
  }

  return attachProviderMetadata(transcript.data, envelope.metadata)
}

export function parseVlmScenes(value: unknown): VLMScene[] {
  const envelope = parseProviderResponseEnvelope(value)

  value = envelope.data

  const scenes = VlmScenesSchema.safeParse(value)

  if (!scenes.success) {
    throw new TypeError('VLM provider returned an invalid scene list.')
  }

  return attachProviderMetadata(scenes.data, envelope.metadata)
}

export function parseTtsSegments(value: unknown): TTSSegment[] {
  const envelope = parseProviderResponseEnvelope(value)

  value = envelope.data

  const segments = TtsSegmentsSchema.safeParse(value)

  if (!segments.success) {
    throw new TypeError('TTS provider returned an invalid segment list.')
  }

  return attachProviderMetadata(segments.data, envelope.metadata)
}

function parseProviderResponseEnvelope(value: unknown): ProviderResponseEnvelope {
  if (!isRecord(value) || !('data' in value)) {
    return {data: value}
  }

  return {
    data: value.data,
    ...(value.metadata === undefined ? {} : {metadata: parseProviderResponseMetadata(value.metadata)}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
