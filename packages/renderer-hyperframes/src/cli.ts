import {runProcess} from '@video-agent/media'

export interface HyperframesCliOptions {
  command?: string[]
  projectDir: string
}

export interface HyperframesRenderCliOptions extends HyperframesCliOptions {
  outputPath: string
}

export interface HyperframesCliResult {
  command: string[]
  stderr: string
  stdout: string
}

export class HyperframesCliError extends Error {
  constructor(
    message: string,
    readonly command: string[],
    readonly stderr: string,
  ) {
    super(message)
  }
}

export function buildHyperframesValidateArgs(options: HyperframesCliOptions): string[] {
  return [...resolveHyperframesCommand(options.command), 'validate', options.projectDir]
}

export function buildHyperframesRenderArgs(options: HyperframesRenderCliOptions): string[] {
  return [...resolveHyperframesCommand(options.command), 'render', options.projectDir, '--output', options.outputPath]
}

export async function validateHyperframesProject(options: HyperframesCliOptions): Promise<HyperframesCliResult> {
  return runHyperframesCommand(buildHyperframesValidateArgs(options))
}

export async function renderHyperframesProject(options: HyperframesRenderCliOptions): Promise<HyperframesCliResult> {
  return runHyperframesCommand(buildHyperframesRenderArgs(options))
}

function resolveHyperframesCommand(command: string[] | undefined): string[] {
  return command === undefined ? ['hyperframes'] : command
}

async function runHyperframesCommand(command: string[]): Promise<HyperframesCliResult> {
  const result = await runProcess(command)

  if (result.code !== 0) {
    throw new HyperframesCliError(`HyperFrames command failed with exit code ${result.code}`, command, result.stderr)
  }

  return {
    command,
    stderr: result.stderr,
    stdout: result.stdout,
  }
}
