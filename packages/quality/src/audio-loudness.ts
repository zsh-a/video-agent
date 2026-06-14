import type {QualityIssue} from './timeline.js'

export interface AudioLoudnessInput {
  maxVolumeDb?: number
  meanVolumeDb?: number
}

export interface AudioLoudnessQualityResult {
  errors: number
  issues: QualityIssue[]
  maxVolumeDb?: number
  meanVolumeDb?: number
  probed: boolean
  warnings: number
}

export function checkAudioLoudness(input: AudioLoudnessInput): AudioLoudnessQualityResult {
  const issues = [...checkProbeAvailability(input), ...checkMeanVolume(input.meanVolumeDb), ...checkMaxVolume(input.maxVolumeDb)]

  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    issues,
    ...(input.maxVolumeDb === undefined ? {} : {maxVolumeDb: input.maxVolumeDb}),
    ...(input.meanVolumeDb === undefined ? {} : {meanVolumeDb: input.meanVolumeDb}),
    probed: true,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

export function createAudioLoudnessProbeFailure(message: string): AudioLoudnessQualityResult {
  const issues: QualityIssue[] = [
    {
      code: 'audio.loudness.probe_failed',
      message,
      severity: 'warning',
    },
  ]

  return {
    errors: 0,
    issues,
    probed: false,
    warnings: 1,
  }
}

function checkProbeAvailability(input: AudioLoudnessInput): QualityIssue[] {
  if (input.meanVolumeDb !== undefined && input.maxVolumeDb !== undefined) {
    return []
  }

  return [
    {
      code: 'audio.loudness.unavailable',
      message: 'Audio loudness could not be read from ffmpeg volumedetect output.',
      severity: 'warning',
    },
  ]
}

function checkMeanVolume(meanVolumeDb: number | undefined): QualityIssue[] {
  if (meanVolumeDb === undefined) {
    return []
  }

  if (meanVolumeDb < -35) {
    return [
      {
        code: 'audio.loudness.quiet',
        message: `Audio mean volume ${meanVolumeDb} dB is very quiet.`,
        severity: 'warning',
      },
    ]
  }

  if (meanVolumeDb > -8) {
    return [
      {
        code: 'audio.loudness.loud',
        message: `Audio mean volume ${meanVolumeDb} dB is very loud.`,
        severity: 'warning',
      },
    ]
  }

  return []
}

function checkMaxVolume(maxVolumeDb: number | undefined): QualityIssue[] {
  if (maxVolumeDb === undefined || maxVolumeDb <= -0.5) {
    return []
  }

  return [
    {
      code: 'audio.loudness.clipping_risk',
      message: `Audio max volume ${maxVolumeDb} dB is close to clipping.`,
      severity: 'warning',
    },
  ]
}
