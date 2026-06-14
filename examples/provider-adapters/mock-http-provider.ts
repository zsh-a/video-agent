import type {IncomingMessage, ServerResponse} from 'node:http'

import {createServer} from 'node:http'

interface ProviderEnvelope {
  data: unknown
  metadata: {
    model: string
    requestId: string
    usage: Record<string, number>
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST') {
    writeJson(response, 405, {
      error: 'Only POST requests are supported.',
    })
    return
  }

  const payload = parsePayload(await readBody(request))
  const envelope = createMockHttpProviderEnvelope(payload, {
    'x-video-agent-kind': readHeader(request, 'x-video-agent-kind'),
    'x-video-agent-request-id': readHeader(request, 'x-video-agent-request-id'),
  })

  writeJson(response, 200, envelope)
}

export function createMockHttpProviderEnvelope(payload: Record<string, unknown>, headers: Record<string, string | undefined> = {}): ProviderEnvelope {
  const kind = headers['x-video-agent-kind'] ?? (typeof payload.kind === 'string' ? payload.kind : 'unknown')
  const requestId = headers['x-video-agent-request-id'] ?? `example-http-${kind}`

  switch (kind) {
    case 'asr': {
      return createEnvelope(requestId, {
        language: 'en',
        segments: [
          {
            end: 1,
            speaker: 'example',
            start: 0,
            text: `Example transcript for ${readInputPath(payload)}`,
          },
        ],
        text: `Example transcript for ${readInputPath(payload)}`,
      }, {
        audioSeconds: 1,
        outputCharacters: 42,
      })
    }

    case 'tts': {
      const segments = readNarrationSegments(payload)

      return createEnvelope(requestId, segments.map((segment) => ({
        duration: segment.duration,
        narrationId: segment.id,
        path: `tts/${segment.id}.wav`,
      })), {
        inputCharacters: segments.reduce((count, segment) => count + segment.text.length, 0),
      })
    }

    case 'vlm': {
      const scenes = readSceneBatches(payload)

      return createEnvelope(requestId, scenes.map((scene) => ({
        description: `Example visual analysis for ${scene.sceneId}`,
        evidence: scene.frames,
        sceneId: scene.sceneId,
      })), {
        inputImages: scenes.reduce((count, scene) => count + scene.frames.length, 0),
      })
    }

    default: {
      throw new Error(`Unsupported provider kind: ${kind}`)
    }
  }
}

function createEnvelope(requestId: string, data: unknown, usage: Record<string, number>): ProviderEnvelope {
  return {
    data,
    metadata: {
      model: 'example-http-provider',
      requestId,
      usage,
    },
  }
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
  })
  response.end(`${JSON.stringify(value)}\n`)
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf8')
}

function parsePayload(text: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown

  if (!isRecord(value)) {
    throw new TypeError('Provider payload must be a JSON object.')
  }

  return value
}

function readHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]

  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

function readInputPath(value: Record<string, unknown>): string {
  const {input} = value

  return isRecord(input) && typeof input.path === 'string' ? input.path : 'unknown-input'
}

function readSceneBatches(value: Record<string, unknown>): Array<{frames: string[]; sceneId: string}> {
  const input = Array.isArray(value.input) ? value.input : []

  return input.map((scene, index) => {
    if (!isRecord(scene)) {
      return {
        frames: [],
        sceneId: `scene-${index + 1}`,
      }
    }

    return {
      frames: Array.isArray(scene.frames) ? scene.frames.filter((frame): frame is string => typeof frame === 'string') : [],
      sceneId: typeof scene.sceneId === 'string' ? scene.sceneId : `scene-${index + 1}`,
    }
  })
}

function readNarrationSegments(value: Record<string, unknown>): Array<{duration: number; id: string; text: string}> {
  const segments = Array.isArray(value.segments) ? value.segments : []

  return segments.map((segment, index) => {
    if (!isRecord(segment)) {
      return {
        duration: 1,
        id: `narration-${index + 1}`,
        text: '',
      }
    }

    return {
      duration: typeof segment.duration === 'number' ? segment.duration : 1,
      id: typeof segment.id === 'string' ? segment.id : `narration-${index + 1}`,
      text: typeof segment.text === 'string' ? segment.text : '',
    }
  })
}

function startServer(): void {
  const host = process.env.HOST ?? '127.0.0.1'
  const port = Number.parseInt(process.env.PORT ?? '4318', 10)
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
      writeJson(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  })

  server.listen(port, host, () => {
    const address = server.address()
    const actualPort = typeof address === 'object' && address !== null ? address.port : port

    process.stdout.write(`listening http://${host}:${actualPort}\n`)
  })

  const shutdown = () => {
    closeServer(server)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

function closeServer(server: ReturnType<typeof createServer>): void {
  server.close()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

if (process.argv[1]?.endsWith('mock-http-provider.ts') === true) {
  startServer()
}
