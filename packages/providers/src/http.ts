/* eslint-disable n/no-unsupported-features/node-builtins */
import type {NarrationSegment} from '@video-agent/ir'

import {randomUUID} from 'node:crypto'

import type {ASRProvider, MediaInput, SceneFrameBatch, Transcript, TTSProvider, TTSSegment, VLMProvider, VLMScene} from './contracts.js'

import {parseTranscript, parseTtsSegments, parseVlmScenes} from './json-response.js'
import {parseProviderResponseMetadata} from './metadata.js'

export interface HttpProviderOptions {
  fetch?: ProviderFetch
  headers?: Record<string, string>
  timeoutMs?: number
  url: string
}

export type ProviderFetch = (input: string, init: ProviderFetchInit) => Promise<ProviderFetchResponse>

export interface ProviderFetchInit {
  body: string
  headers: Record<string, string>
  method: 'POST'
  signal: AbortSignal
}

export interface ProviderFetchResponse {
  json(): Promise<unknown>
  ok: boolean
  status: number
  text(): Promise<string>
}

export class HttpASRProvider implements ASRProvider {
  constructor(private readonly options: HttpProviderOptions) {}

  async transcribe(input: MediaInput): Promise<Transcript> {
    return parseTranscript(
      await runProviderRequest(this.options, {
        input,
        kind: 'asr',
        version: 1,
      }),
    )
  }
}

export class HttpVLMProvider implements VLMProvider {
  constructor(private readonly options: HttpProviderOptions) {}

  async analyzeScenes(input: SceneFrameBatch[], context?: string): Promise<VLMScene[]> {
    return parseVlmScenes(
      await runProviderRequest(this.options, {
        context,
        input,
        kind: 'vlm',
        version: 1,
      }),
    )
  }
}

export class HttpTTSProvider implements TTSProvider {
  constructor(private readonly options: HttpProviderOptions) {}

  async synthesize(segments: NarrationSegment[]): Promise<TTSSegment[]> {
    return parseTtsSegments(
      await runProviderRequest(this.options, {
        kind: 'tts',
        segments,
        version: 1,
      }),
    )
  }
}

async function runProviderRequest(options: HttpProviderOptions, payload: unknown): Promise<unknown> {
  const controller = new AbortController()
  const providerRequestId = `http_${randomUUID()}`
  const timeout = setTimeout(() => {
    controller.abort()
  }, options.timeoutMs ?? 60_000)
  const payloadRecord = isRecord(payload) ? payload : {}
  const kind = typeof payloadRecord.kind === 'string' ? payloadRecord.kind : 'provider'
  const version = typeof payloadRecord.version === 'number' ? String(payloadRecord.version) : '1'

  try {
    const request = options.fetch ?? fetch
    const response = await request(options.url, {
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
        'x-video-agent-kind': kind,
        'x-video-agent-request-id': providerRequestId,
        'x-video-agent-version': version,
        ...options.headers,
      },
      method: 'POST',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP provider request failed with status ${response.status}: ${await response.text()}`)
    }

    return withHttpProviderMetadata((await response.json()) as unknown, providerRequestId)
  } finally {
    clearTimeout(timeout)
  }
}

function withHttpProviderMetadata(value: unknown, requestId: string): unknown {
  if (isRecord(value) && 'data' in value) {
    const metadata = parseProviderResponseMetadata(value.metadata)

    return {
      ...value,
      metadata: {
        ...metadata,
        requestId: metadata?.requestId ?? requestId,
      },
    }
  }

  return {
    data: value,
    metadata: {
      requestId,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
