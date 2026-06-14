import type {Transcript, TranscriptSegment, TTSSegment, VLMScene} from './contracts.js'
import type {ProviderResponseMetadata} from './metadata.js'

import {attachProviderMetadata, parseProviderResponseMetadata} from './metadata.js'

interface ProviderResponseEnvelope {
  data: unknown
  metadata?: ProviderResponseMetadata
}

export function parseTranscript(value: unknown): Transcript {
  const envelope = parseProviderResponseEnvelope(value)

  value = envelope.data

  if (!isRecord(value) || typeof value.text !== 'string' || !Array.isArray(value.segments)) {
    throw new TypeError('ASR provider returned an invalid transcript.')
  }

  return attachProviderMetadata({
    ...(typeof value.language === 'string' ? {language: value.language} : {}),
    segments: value.segments.map((segment) => parseTranscriptSegment(segment)),
    text: value.text,
  }, envelope.metadata)
}

export function parseVlmScenes(value: unknown): VLMScene[] {
  const envelope = parseProviderResponseEnvelope(value)

  value = envelope.data

  if (!Array.isArray(value)) {
    throw new TypeError('VLM provider returned an invalid scene list.')
  }

  return attachProviderMetadata(value.map((scene) => {
    if (!isRecord(scene) || typeof scene.description !== 'string' || !Array.isArray(scene.evidence) || typeof scene.sceneId !== 'string') {
      throw new TypeError('VLM provider returned an invalid scene.')
    }

    return {
      description: scene.description,
      evidence: scene.evidence.map((item) => {
        if (typeof item !== 'string') {
          throw new TypeError('VLM provider returned invalid scene evidence.')
        }

        return item
      }),
      sceneId: scene.sceneId,
    }
  }), envelope.metadata)
}

export function parseTtsSegments(value: unknown): TTSSegment[] {
  const envelope = parseProviderResponseEnvelope(value)

  value = envelope.data

  if (!Array.isArray(value)) {
    throw new TypeError('TTS provider returned an invalid segment list.')
  }

  return attachProviderMetadata(value.map((segment) => {
    if (!isRecord(segment) || typeof segment.duration !== 'number' || typeof segment.narrationId !== 'string' || typeof segment.path !== 'string') {
      throw new TypeError('TTS provider returned an invalid segment.')
    }

    return {
      duration: segment.duration,
      narrationId: segment.narrationId,
      path: segment.path,
    }
  }), envelope.metadata)
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

function parseTranscriptSegment(value: unknown): TranscriptSegment {
  if (!isRecord(value) || typeof value.start !== 'number' || typeof value.end !== 'number' || typeof value.text !== 'string') {
    throw new TypeError('ASR provider returned an invalid transcript segment.')
  }

  return {
    end: value.end,
    ...(typeof value.speaker === 'string' ? {speaker: value.speaker} : {}),
    start: value.start,
    text: value.text,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
