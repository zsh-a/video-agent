import {runProcess} from '@video-agent/media'
import {stat} from 'node:fs/promises'
import {resolve} from 'node:path'

export interface RemotionRenderCliOptions {
  command?: string[]
  outputPath?: string
  projectDir: string
}

export interface RemotionRenderCliResult {
  command: string[]
  outputPath: string
  stderr: string
  stdout: string
}

export class RemotionRenderCliError extends Error {
  constructor(
    message: string,
    readonly command: string[],
    readonly stderr: string,
  ) {
    super(message)
  }
}

export function buildRemotionRenderArgs(options: Pick<RemotionRenderCliOptions, 'command'>): string[] {
  return options.command ?? ['bun', 'run', 'render']
}

export async function renderRemotionDeckProject(options: RemotionRenderCliOptions): Promise<RemotionRenderCliResult> {
  const projectDir = resolve(options.projectDir)
  const outputPath = resolve(options.outputPath ?? resolve(projectDir, 'out', 'final.mp4'))
  const command = buildRemotionRenderArgs(options)
  const result = await runProcess(command, {cwd: projectDir})

  if (result.code !== 0) {
    throw new RemotionRenderCliError(`Remotion command failed with exit code ${result.code}`, command, result.stderr)
  }

  const output = await stat(outputPath)

  if (output.size <= 0) {
    throw new RemotionRenderCliError(`Remotion output is empty: ${outputPath}`, command, result.stderr)
  }

  return {
    command,
    outputPath,
    stderr: result.stderr,
    stdout: result.stdout,
  }
}
