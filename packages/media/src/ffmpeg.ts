import {runProcess, type RunProcessOptions} from './process.js'

export class MediaCommandError extends Error {
  constructor(
    message: string,
    readonly command: string[],
    readonly stderr: string,
  ) {
    super(message)
  }
}

export async function runFfmpeg(args: string[], options?: RunProcessOptions): Promise<void> {
  const command = ['ffmpeg', ...args]
  const result = await runProcess(command, options)

  if (result.code !== 0) {
    throw new MediaCommandError(`ffmpeg failed with exit code ${result.code}`, command, result.stderr)
  }
}

export async function runFfprobe(args: string[], options?: RunProcessOptions): Promise<string> {
  const command = ['ffprobe', ...args]
  const result = await runProcess(command, options)

  if (result.code !== 0) {
    throw new MediaCommandError(`ffprobe failed with exit code ${result.code}`, command, result.stderr)
  }

  return result.stdout
}

export async function extractFrames(input: string, framesPattern: string, fps = 1): Promise<void> {
  await runFfmpeg(['-i', input, '-vf', `fps=${fps}`, framesPattern])
}
