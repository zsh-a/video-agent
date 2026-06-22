import {type MediaInfo, MediaInfoSchema, type MediaStream, MediaStreamTypeSchema} from '@video-agent/ir'
import {z} from 'zod'

const FfprobeFormatSchema = z.object({
  bit_rate: z.string().optional(),
  duration: z.string().optional(),
  format_name: z.string().optional(),
  size: z.string().optional(),
}).passthrough()

const FfprobeStreamSchema = z.object({
  avg_frame_rate: z.string().optional(),
  codec_name: z.string().optional(),
  codec_type: z.string().optional(),
  duration: z.string().optional(),
  height: z.number().int().positive().optional(),
  index: z.number().int().nonnegative(),
  r_frame_rate: z.string().optional(),
  width: z.number().int().positive().optional(),
}).passthrough()

const FfprobeOutputSchema = z.object({
  format: FfprobeFormatSchema.optional(),
  streams: z.array(FfprobeStreamSchema).optional(),
}).passthrough()

type FfprobeOutput = z.infer<typeof FfprobeOutputSchema>
type FfprobeStream = z.infer<typeof FfprobeStreamSchema>

export function parseFfprobeMediaInfo(input: string, stdout: string): MediaInfo {
  const raw = parseFfprobeOutput(stdout)
  const streams = raw.streams?.map(parseStream) ?? []

  return MediaInfoSchema.parse({
    bitrate: parseOptionalNumber(raw.format?.bit_rate, 'ffprobe format bit_rate'),
    duration: parseOptionalNumber(raw.format?.duration, 'ffprobe format duration'),
    formatName: raw.format?.format_name,
    inputPath: input,
    probedAt: new Date().toISOString(),
    size: parseOptionalNumber(raw.format?.size, 'ffprobe format size'),
    streams,
    version: 1,
  })
}

function parseFfprobeOutput(stdout: string): FfprobeOutput {
  let value: unknown

  try {
    value = JSON.parse(stdout) as unknown
  } catch (error) {
    throw new Error(`ffprobe returned invalid JSON; no media-info shape inference fallback is allowed. ${error instanceof Error ? error.message : String(error)}`)
  }

  const result = FfprobeOutputSchema.safeParse(value)

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`).join('; ')

    throw new Error(`ffprobe JSON has invalid shape; no media-info shape inference fallback is allowed. ${issues}`)
  }

  return result.data
}

function parseOptionalNumber(value: string | undefined, field = 'ffprobe numeric field'): number | undefined {
  if (value === undefined || value === 'N/A') {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a finite numeric string; no media-info numeric inference fallback is allowed. Received: ${value}`)
  }

  return parsed
}

function parseFps(value: string | undefined, field: string): number | undefined {
  if (value === undefined || value === '0/0' || value === 'N/A') {
    return undefined
  }

  const [numerator, denominator] = value.split('/').map(Number)

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    throw new Error(`${field} must be an ffprobe frame-rate ratio; no media-info fps inference fallback is allowed. Received: ${value}`)
  }

  return numerator / denominator
}

function parseStream(stream: FfprobeStream): MediaStream {
  const type = stream.codec_type === undefined ? 'unknown' : stream.codec_type
  const parsedType = MediaStreamTypeSchema.safeParse(type)

  return {
    codecName: stream.codec_name,
    duration: parseOptionalNumber(stream.duration, `ffprobe stream ${stream.index} duration`),
    fps: parseFps(stream.avg_frame_rate, `ffprobe stream ${stream.index} avg_frame_rate`) ?? parseFps(stream.r_frame_rate, `ffprobe stream ${stream.index} r_frame_rate`),
    height: stream.height,
    index: stream.index,
    type: parsedType.success ? parsedType.data : 'unknown',
    width: stream.width,
  }
}
