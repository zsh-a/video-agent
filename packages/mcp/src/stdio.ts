import type {Readable, Writable} from 'node:stream'

import {createVideoAgentMcpServer, type McpServerOptions} from './server.js'

export interface McpStdioOptions extends McpServerOptions {
  stderr?: Writable
  stdin?: Readable
  stdout?: Writable
}

export function startMcpStdioServer(options: McpStdioOptions = {}): void {
  const stdin: Readable = options.stdin ?? process.stdin
  const stdout: Writable = options.stdout ?? process.stdout
  const stderr: Writable = options.stderr ?? process.stderr
  const server = createVideoAgentMcpServer({workspaceDir: options.workspaceDir})
  let buffer = Buffer.alloc(0)

  stdin.on('data', (chunk: Buffer | string) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])

    processBuffer().catch((error: unknown) => {
      stderr.write(`video-agent MCP error: ${error instanceof Error ? error.message : String(error)}\n`)
    })
  })

  async function processBuffer(): Promise<void> {
    let message = readFramedMessage(buffer)

    /* eslint-disable no-await-in-loop */
    while (message !== undefined) {
      buffer = buffer.subarray(message.bytesRead)

      const response = await server.handleMessage(JSON.parse(message.body) as unknown)

      if (response !== undefined) {
        stdout.write(frameMessage(JSON.stringify(response)))
      }

      message = readFramedMessage(buffer)
    }
    /* eslint-enable no-await-in-loop */
  }
}

interface FramedMessage {
  body: string
  bytesRead: number
}

function readFramedMessage(buffer: Buffer): FramedMessage | undefined {
  const separator = buffer.indexOf('\r\n\r\n')

  if (separator === -1) {
    return undefined
  }

  const header = buffer.subarray(0, separator).toString('utf8')
  const contentLength = readContentLength(header)
  const bodyStart = separator + 4
  const bodyEnd = bodyStart + contentLength

  if (buffer.length < bodyEnd) {
    return undefined
  }

  return {
    body: buffer.subarray(bodyStart, bodyEnd).toString('utf8'),
    bytesRead: bodyEnd,
  }
}

function readContentLength(header: string): number {
  const line = header.split('\r\n').find((part) => part.toLowerCase().startsWith('content-length:'))

  if (line === undefined) {
    throw new Error('Missing Content-Length header.')
  }

  const value = Number(line.slice('content-length:'.length).trim())

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid Content-Length header: ${line}`)
  }

  return value
}

function frameMessage(body: string): string {
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}
