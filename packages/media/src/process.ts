/* eslint-disable n/no-unsupported-features/node-builtins */

type BunProcess = {
  exited: Promise<number>
  stderr: {text(): Promise<string>}
  stdout: {text(): Promise<string>}
}

interface BunRuntime {
  spawn(command: string[], options?: {
    cwd?: string
    env?: Record<string, string>
    stdio?: ['ignore' | Blob, 'pipe', 'pipe']
  }): BunProcess
}

export interface ProcessResult {
  code: number
  stderr: string
  stdout: string
}

export interface RunProcessOptions {
  cwd?: string
  env?: Record<string, string>
  stdin?: string
}

export async function runProcess(command: string[], options: RunProcessOptions = {}): Promise<ProcessResult> {
  const bun = getBunRuntime()

  if (bun === undefined) {
    throw new Error('runProcess requires Bun runtime.')
  }

  const proc = bun.spawn(command, {
    cwd: options.cwd,
    env: createProcessEnv(options.env),
    stdio: [createBunStdin(options.stdin), 'pipe', 'pipe'],
  })

  const [code, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()])
  return {code, stderr, stdout}
}

function getBunRuntime(): BunRuntime | undefined {
  return (globalThis as typeof globalThis & {Bun?: BunRuntime}).Bun
}

function createBunStdin(stdin: string | undefined): 'ignore' | Blob {
  if (stdin === undefined) {
    return 'ignore'
  }

  return new Blob([stdin])
}

function createProcessEnv(env: Record<string, string> | undefined): Record<string, string> {
  const entries = Object.entries({
    ...process.env,
    ...env,
  }).filter((entry): entry is [string, string] => entry[1] !== undefined)

  return Object.fromEntries(entries)
}
