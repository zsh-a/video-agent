import type {MediaInfo} from '@video-agent/ir'

import {bunRuntime} from './bun-runtime.js'
import {
  type AudioVolumeInfo,
  parseAudioVolumeOutput,
  parseVideoBlackDetectOutput,
  parseVideoSceneChangeTimestamps,
  type VideoBlackDetectInfo,
  type VideoSceneChangeInfo,
} from './ffmpeg-inspection.js'
import {type FfmpegProgressHandler, readFfmpegProgressStream} from './ffmpeg-progress.js'
import {parseFfprobeMediaInfo} from './ffprobe.js'
import {runProcess, type RunProcessOptions} from './process.js'

export {parseAudioVolumeOutput, parseVideoBlackDetectOutput} from './ffmpeg-inspection.js'
export type {AudioVolumeInfo, VideoBlackDetectInfo, VideoBlackSegment, VideoSceneChangeInfo} from './ffmpeg-inspection.js'
export {parseFfmpegProgressOutput} from './ffmpeg-progress.js'
export type {FfmpegProgressRecord} from './ffmpeg-progress.js'

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

export interface RunFfmpegWithProgressOptions extends RunProcessOptions {
  onProgress?: FfmpegProgressHandler
  statsPeriodSeconds?: number
}

export async function runFfmpegWithProgress(args: string[], options: RunFfmpegWithProgressOptions = {}): Promise<void> {
  const bun = bunRuntime()
  const command = ['ffmpeg', '-nostdin', '-progress', 'pipe:1', '-stats_period', String(options.statsPeriodSeconds ?? 0.5), ...args]
  const proc = bun.spawn(command, {
    cwd: options.cwd,
    env: createProcessEnv(bun.env, options.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const [code, stderr] = await Promise.all([
    proc.exited,
    readFfmpegProgressStream(proc.stdout, options.onProgress),
    proc.stderr.text(),
  ]).then(([exitCode, , stderrText]) => [exitCode, stderrText] as const)

  if (code !== 0) {
    throw new MediaCommandError(`ffmpeg failed with exit code ${code}`, command, stderr)
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

function createProcessEnv(baseEnv: Record<string, string | undefined>, env: Record<string, string> | undefined): Record<string, string> {
  const entries = Object.entries({
    ...baseEnv,
    ...env,
  }).filter((entry): entry is [string, string] => entry[1] !== undefined)

  return Object.fromEntries(entries)
}

export async function extractFrames(input: string, framesPattern: string, fps = 1): Promise<void> {
  await runFfmpeg(['-y', '-i', input, '-vf', `fps=${fps}`, framesPattern])
}

export async function extractAudio(input: string, outputPath: string): Promise<void> {
  await runFfmpeg(['-y', '-i', input, '-vn', '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1', outputPath])
}

export async function extractAudioSegment(input: string, outputPath: string, start: number, duration: number): Promise<void> {
  await runFfmpeg(['-y', '-ss', String(start), '-t', String(duration), '-i', input, '-vn', '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1', outputPath])
}

export async function createPreview(input: string, outputPath: string, duration = 10): Promise<void> {
  await runFfmpeg(['-y', '-i', input, '-t', String(duration), '-c', 'copy', outputPath])
}

export async function extractVideoFrame(input: string, outputPath: string, timestamp = 0): Promise<void> {
  await runFfmpeg(['-y', '-ss', String(timestamp), '-i', input, '-frames:v', '1', '-q:v', '2', outputPath])
}

export async function probeMedia(input: string, options?: RunProcessOptions): Promise<MediaInfo> {
  const stdout = await runFfprobe(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input], options)
  return parseFfprobeMediaInfo(input, stdout)
}

export async function inspectAudioVolume(input: string, options?: RunProcessOptions): Promise<AudioVolumeInfo> {
  const command = ['ffmpeg', '-hide_banner', '-nostats', '-i', input, '-af', 'volumedetect', '-f', 'null', '-']
  const result = await runProcess(command, options)

  if (result.code !== 0) {
    throw new MediaCommandError(`ffmpeg volumedetect failed with exit code ${result.code}`, command, result.stderr)
  }

  return parseAudioVolumeOutput(input, result.stderr)
}

export async function inspectVideoBlackDetect(input: string, duration?: number, options?: RunProcessOptions): Promise<VideoBlackDetectInfo> {
  const command = ['ffmpeg', '-hide_banner', '-nostats', '-i', input, '-vf', 'blackdetect=d=0.1:pix_th=0.10', '-an', '-f', 'null', '-']
  const result = await runProcess(command, options)

  if (result.code !== 0) {
    throw new MediaCommandError(`ffmpeg blackdetect failed with exit code ${result.code}`, command, result.stderr)
  }

  return parseVideoBlackDetectOutput(input, result.stderr, duration)
}

export async function detectVideoSceneChanges(input: string, threshold = 0.3, options?: RunProcessOptions): Promise<VideoSceneChangeInfo> {
  const command = [
    'ffmpeg',
    '-hide_banner',
    '-nostats',
    '-i',
    input,
    '-an',
    '-filter:v',
    `select=gt(scene\\,${threshold}),showinfo`,
    '-f',
    'null',
    '-',
  ]
  const result = await runProcess(command, options)

  if (result.code !== 0) {
    throw new MediaCommandError(`ffmpeg scene detection failed with exit code ${result.code}`, command, result.stderr)
  }

  return {
    inputPath: input,
    inspectedAt: new Date().toISOString(),
    raw: result.stderr,
    threshold,
    timestamps: parseVideoSceneChangeTimestamps(result.stderr),
    version: 1,
  }
}
