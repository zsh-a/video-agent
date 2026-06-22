import type {LLMUsage} from '@video-agent/llm'

import {extname} from 'node:path'

import type {MediaInput} from '../contracts.js'

export function createAudioDataUri(audio: Uint8Array, mediaType: string): string {
  return createFileDataUri(audio, mediaType)
}

export function createFileDataUri(data: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${Buffer.from(data).toString('base64')}`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mergeLLMUsage(usages: LLMUsage[]): LLMUsage | undefined {
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

export function normalizeBaseURL(value: string): string {
  const trimmed = value.trim()

  if (trimmed === '') {
    throw new Error('MiMo TTS baseURL must be configured.')
  }

  return trimmed.replaceAll(/\/+$/g, '')
}

export function normalizeOutputDir(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error('MiMo TTS requires an outputDir so generated audio can be written to the project workspace.')
  }

  return value
}

export function normalizePathPrefix(value: string): string {
  return value.replaceAll(/\\/g, '/').replaceAll(/^\/+|\/+$/g, '')
}

export function normalizePositiveFiniteNumber(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? undefined : value
}

export function readStringField(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const item = value[field]

  return typeof item === 'string' && item.trim() !== '' ? item : undefined
}

export function resolveAudioMimeType(input: MediaInput): string {
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

export function resolveImageMimeType(path: string): string {
  const ext = extname(path).toLowerCase().slice(1)
  const mimeTypes: Record<string, string> = {
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }

  return mimeTypes[ext] ?? 'image/jpeg'
}

export function roundTimestamp(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function sanitizePathSegment(value: string): string {
  const sanitized = value
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

  return sanitized === '' ? 'segment' : sanitized
}

function sumOptionalUsage(usages: LLMUsage[], key: keyof LLMUsage): number | undefined {
  const values = usages.flatMap((usage) => (usage[key] === undefined ? [] : [usage[key]]))

  return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0)
}
