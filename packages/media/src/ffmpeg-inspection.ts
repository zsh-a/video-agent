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

export interface VideoSceneChangeInfo {
  inputPath: string
  inspectedAt: string
  raw: string
  threshold: number
  timestamps: number[]
  version: 1
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
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) {
    throw new Error(`ffmpeg blackdetect duration must be a positive finite number when provided; no black-ratio omission fallback is allowed. Received: ${String(duration)}`)
  }

  const blackSegments = parseBlackSegments(stderr)
  const blackDuration = blackSegments.reduce((total, segment) => total + segment.duration, 0)
  const blackRatio = duration === undefined ? undefined : blackDuration / duration

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

export function parseVideoSceneChangeTimestamps(raw: string): number[] {
  const timestamps = Array.from(raw.matchAll(/pts_time:([0-9.]+)/gu), (match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value >= 0)

  return [...new Set(timestamps)].sort((left, right) => left - right)
}

function parseVolumeFields(output: string): Pick<AudioVolumeInfo, 'maxVolumeDb' | 'meanVolumeDb'> {
  const meanVolumeDb = parseInspectionNumber(output.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)?.[1])
  const maxVolumeDb = parseInspectionNumber(output.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)?.[1])

  return {
    ...(maxVolumeDb === undefined ? {} : {maxVolumeDb}),
    ...(meanVolumeDb === undefined ? {} : {meanVolumeDb}),
  }
}

function parseInspectionNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseBlackSegments(output: string): VideoBlackSegment[] {
  return [...output.matchAll(/black_start:(-?\d+(?:\.\d+)?)\s+black_end:(-?\d+(?:\.\d+)?)\s+black_duration:(-?\d+(?:\.\d+)?)/g)].flatMap((match) => {
    const start = parseInspectionNumber(match[1])
    const end = parseInspectionNumber(match[2])
    const duration = parseInspectionNumber(match[3])

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
