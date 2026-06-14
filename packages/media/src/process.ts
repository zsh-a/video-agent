import {spawn} from 'node:child_process'

type BunProcess = {
  exited: Promise<number>
  stderr: {text(): Promise<string>}
  stdout: {text(): Promise<string>}
}

declare const Bun:
  | undefined
  | {
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
}

export async function runProcess(command: string[], options: RunProcessOptions = {}): Promise<ProcessResult> {
  if (options.preferBun !== false && Bun !== undefined) {
    const proc = Bun.spawn(command, {
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
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({code: code ?? 1, stderr, stdout}))
  })
}
