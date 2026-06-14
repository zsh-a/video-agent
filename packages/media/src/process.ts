import {spawn} from 'node:child_process'

type BunProcess = {
  exited: Promise<number>
  stderr: {text(): Promise<string>}
  stdout: {text(): Promise<string>}
}

interface BunRuntime {
  spawn(command: string[], options?: {cwd?: string; env?: Record<string, string>; stderr?: 'pipe'; stdout?: 'pipe'}): BunProcess
}

export interface ProcessResult {
  code: number
  stderr: string
  stdout: string
}

export interface RunProcessOptions {
  cwd?: string
  env?: Record<string, string>
  preferBun?: boolean
  stdin?: string
}

export async function runProcess(command: string[], options: RunProcessOptions = {}): Promise<ProcessResult> {
  const bun = getBunRuntime()

  if (options.preferBun !== false && options.stdin === undefined && bun !== undefined) {
    const proc = bun.spawn(command, {
      cwd: options.cwd,
      env: options.env,
      stderr: 'pipe',
      stdout: 'pipe',
    })

    const [code, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()])
    return {code, stderr, stdout}
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: {...process.env, ...options.env},
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    if (child.stdout === null || child.stderr === null) {
      reject(new Error('Failed to open child process output pipes.'))
      return
    }

    const {stdin} = child

    if (options.stdin !== undefined && stdin === null) {
      reject(new Error('Failed to open child process input pipe.'))
      return
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    if (options.stdin !== undefined) {
      stdin?.end(options.stdin)
    }

    child.on('error', reject)
    child.on('close', (code) => resolve({code: code ?? 1, stderr, stdout}))
  })
}

function getBunRuntime(): BunRuntime | undefined {
  return (globalThis as typeof globalThis & {Bun?: BunRuntime}).Bun
}
