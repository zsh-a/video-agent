import {type MediaInfo, MediaInfoSchema, type MediaStream, MediaStreamTypeSchema} from '@video-agent/ir'

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
  await runFfmpeg(['-y', '-i', input, '-vf', `fps=${fps}`, framesPattern])
}

export async function extractAudio(input: string, outputPath: string): Promise<void> {
  await runFfmpeg(['-y', '-i', input, '-vn', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', outputPath])
}

export async function createPreview(input: string, outputPath: string, duration = 10): Promise<void> {
  await runFfmpeg(['-y', '-i', input, '-t', String(duration), '-c', 'copy', outputPath])
}

export async function extractVideoFrame(input: string, outputPath: string, timestamp = 0): Promise<void> {
  await runFfmpeg(['-y', '-ss', String(timestamp), '-i', input, '-frames:v', '1', '-q:v', '2', outputPath])
}

export async function probeMedia(input: string, options?: RunProcessOptions): Promise<MediaInfo> {
  const stdout = await runFfprobe(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input], options)
  const raw = JSON.parse(stdout) as FfprobeOutput
  const streams = raw.streams?.map(parseStream) ?? []

  return MediaInfoSchema.parse({
    bitrate: parseOptionalNumber(raw.format?.bit_rate),
    duration: parseOptionalNumber(raw.format?.duration),
    formatName: raw.format?.format_name,
    inputPath: input,
    probedAt: new Date().toISOString(),
    size: parseOptionalNumber(raw.format?.size),
    streams,
    version: 1,
  })
}

export interface AudioVolumeInfo {
  inputPath: string
  inspectedAt: string
  maxVolumeDb?: number
  meanVolumeDb?: number
  raw: string
  version: 1
}

export interface VideoBlackDetectInfo {
  blackDuration: number
  blackRatio?: number
  blackSegments: VideoBlackSegment[]
  duration?: number
  inputPath: string
  inspectedAt: string
  raw: string
  version: 1
}

export interface VideoBlackSegment {
  duration: number
  end: number
  start: number
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

export function parseAudioVolumeOutput(input: string, stderr: string): AudioVolumeInfo {
  return {
    inputPath: input,
    inspectedAt: new Date().toISOString(),
    ...parseVolumeFields(stderr),
    raw: stderr,
    version: 1,
  }
}

export function parseVideoBlackDetectOutput(input: string, stderr: string, duration?: number): VideoBlackDetectInfo {
  const blackSegments = parseBlackSegments(stderr)
  const blackDuration = blackSegments.reduce((total, segment) => total + segment.duration, 0)
  const blackRatio = duration === undefined || duration <= 0 ? undefined : blackDuration / duration

  return {
    blackDuration,
    ...(blackRatio === undefined ? {} : {blackRatio}),
    blackSegments,
    ...(duration === undefined ? {} : {duration}),
    inputPath: input,
    inspectedAt: new Date().toISOString(),
    raw: stderr,
    version: 1,
  }
}

interface FfprobeFormat {
  bit_rate?: string
  duration?: string
  format_name?: string
  size?: string
}

interface FfprobeOutput {
  format?: FfprobeFormat
  streams?: FfprobeStream[]
}

interface FfprobeStream {
  avg_frame_rate?: string
  codec_name?: string
  codec_type?: string
  duration?: string
  height?: number
  index?: number
  r_frame_rate?: string
  width?: number
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === 'N/A') {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseFps(value: string | undefined): number | undefined {
  if (value === undefined || value === '0/0') {
    return undefined
  }

  const [numerator, denominator] = value.split('/').map(Number)

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return undefined
  }

  return numerator / denominator
}

function parseVolumeFields(output: string): Pick<AudioVolumeInfo, 'maxVolumeDb' | 'meanVolumeDb'> {
  const meanVolumeDb = parseVolumeValue(output.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)?.[1])
  const maxVolumeDb = parseVolumeValue(output.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)?.[1])

  return {
    ...(maxVolumeDb === undefined ? {} : {maxVolumeDb}),
    ...(meanVolumeDb === undefined ? {} : {meanVolumeDb}),
  }
}

function parseVolumeValue(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseBlackSegments(output: string): VideoBlackSegment[] {
  return [...output.matchAll(/black_start:(-?\d+(?:\.\d+)?)\s+black_end:(-?\d+(?:\.\d+)?)\s+black_duration:(-?\d+(?:\.\d+)?)/g)].flatMap((match) => {
    const start = parseVolumeValue(match[1])
    const end = parseVolumeValue(match[2])
    const duration = parseVolumeValue(match[3])

    if (start === undefined || end === undefined || duration === undefined) {
      return []
    }

    return [
      {
        duration,
        end,
        start,
      },
    ]
  })
}

function parseStream(stream: FfprobeStream): MediaStream {
  const type = stream.codec_type === undefined ? 'unknown' : stream.codec_type
  const parsedType = MediaStreamTypeSchema.safeParse(type)

  return {
    codecName: stream.codec_name,
    duration: parseOptionalNumber(stream.duration),
    fps: parseFps(stream.avg_frame_rate) ?? parseFps(stream.r_frame_rate),
    height: stream.height,
    index: stream.index ?? 0,
    type: parsedType.success ? parsedType.data : 'unknown',
    width: stream.width,
  }
}
