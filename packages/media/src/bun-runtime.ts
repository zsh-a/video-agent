type BunProcess = {
  exited: Promise<number>
  stderr: {text(): Promise<string>}
  stdout: {text(): Promise<string>}
}

export interface MediaBun {
  env: Record<string, string | undefined>
  spawn(command: string[], options?: {
    cwd?: string
    env?: Record<string, string>
    stdio?: ['ignore' | Blob, 'pipe', 'pipe']
  }): BunProcess
}

export function bunRuntime(): MediaBun {
  const bun = (globalThis as typeof globalThis & {Bun?: MediaBun}).Bun

  if (bun === undefined) {
    throw new Error('video-agent media requires Bun.')
  }

  return bun
}
