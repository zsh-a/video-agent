import {bunRuntime} from './bun-runtime.js'

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
  const bun = bunRuntime()

  const proc = bun.spawn(command, {
    cwd: options.cwd,
    env: createProcessEnv(bun.env, options.env),
    stdio: [createBunStdin(options.stdin), 'pipe', 'pipe'],
  })

  const [code, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()])
  return {code, stderr, stdout}
}

function createBunStdin(stdin: string | undefined): 'ignore' | Blob {
  if (stdin === undefined) {
    return 'ignore'
  }

  return new Blob([stdin])
}

function createProcessEnv(baseEnv: Record<string, string | undefined>, env: Record<string, string> | undefined): Record<string, string> {
  const entries = Object.entries({
    ...baseEnv,
    ...env,
  }).filter((entry): entry is [string, string] => entry[1] !== undefined)

  return Object.fromEntries(entries)
}
