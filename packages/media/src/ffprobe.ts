import {type MediaInfo, MediaInfoSchema, type MediaStream, MediaStreamTypeSchema} from '@video-agent/ir'

export function parseFfprobeMediaInfo(input: string, stdout: string): MediaInfo {
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
