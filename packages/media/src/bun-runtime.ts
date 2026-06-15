type BunProcess = {
  exited: Promise<number>
  stderr: BunReadableStream
  stdout: BunReadableStream
}

export interface MediaBun {
  env: Record<string, string | undefined>
  spawn(command: string[], options?: {
    cwd?: string
    env?: Record<string, string>
    stdio?: ['ignore' | Blob, 'pipe', 'pipe']
  }): BunProcess
}

export interface BunReadableStream {
  getReader(): BunReadableStreamReader
  text(): Promise<string>
}

export interface BunReadableStreamReader {
  read(): Promise<{done?: boolean; value?: Uint8Array}>
}

export function bunRuntime(): MediaBun {
  const bun = (globalThis as typeof globalThis & {Bun?: MediaBun}).Bun

  if (bun === undefined) {
    throw new Error('video-agent media requires Bun.')
  }

  return bun
}
