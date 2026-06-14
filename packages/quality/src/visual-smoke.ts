import type {QualityIssue} from './timeline.js'

export interface VisualSmokeInput {
  blackDuration: number
  blackRatio?: number
  blackSegments: VisualBlackSegment[]
  duration?: number
  frameSample?: VisualFrameSample
  frameSamples?: VisualFrameSample[]
}

export interface VisualBlackSegment {
  duration: number
  end: number
  start: number
}

export interface VisualSmokeQualityResult {
  blackDuration: number
  blackRatio?: number
  blackSegments: VisualBlackSegment[]
  duration?: number
  errors: number
  frameSample?: VisualFrameSample
  frameSamples?: VisualFrameSample[]
  issues: QualityIssue[]
  probed: boolean
  warnings: number
}

export interface VisualFrameSample {
  capturedAt: string
  error?: string
  ok: boolean
  path?: string
  sha256?: string
  size?: number
  timestamp: number
}

export function checkVisualSmoke(input: VisualSmokeInput): VisualSmokeQualityResult {
  const frameSamples = normalizeFrameSamples(input)
  const issues = [...checkBlackRatio(input), ...checkBlackDurationWithoutRatio(input), ...checkFrameSamples(frameSamples)]

  return {
    blackDuration: input.blackDuration,
    ...(input.blackRatio === undefined ? {} : {blackRatio: input.blackRatio}),
    blackSegments: input.blackSegments,
    ...(input.duration === undefined ? {} : {duration: input.duration}),
    errors: issues.filter((issue) => issue.severity === 'error').length,
    ...(frameSamples[0] === undefined ? {} : {frameSample: frameSamples[0]}),
    ...(frameSamples.length === 0 ? {} : {frameSamples}),
    issues,
    probed: true,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

export function createVisualSmokeProbeFailure(message: string): VisualSmokeQualityResult {
  const issues: QualityIssue[] = [
    {
      code: 'visual.smoke.probe_failed',
      message,
      severity: 'warning',
    },
  ]

  return {
    blackDuration: 0,
    blackSegments: [],
    errors: 0,
    issues,
    probed: false,
    warnings: 1,
  }
}

export function addVisualFrameSample(result: VisualSmokeQualityResult, frameSample: VisualFrameSample): VisualSmokeQualityResult {
  return addVisualFrameSamples(result, [frameSample])
}

export function addVisualFrameSamples(result: VisualSmokeQualityResult, frameSamples: VisualFrameSample[]): VisualSmokeQualityResult {
  const existingSamples = result.frameSamples ?? (result.frameSample === undefined ? [] : [result.frameSample])
  const nextSamples = [...existingSamples, ...frameSamples]
  const issues = [...result.issues, ...checkFrameSamples(frameSamples)]

  return {
    ...result,
    errors: issues.filter((issue) => issue.severity === 'error').length,
    ...(nextSamples[0] === undefined ? {} : {frameSample: nextSamples[0]}),
    frameSamples: nextSamples,
    issues,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

function checkBlackRatio(input: VisualSmokeInput): QualityIssue[] {
  if (input.blackRatio === undefined || input.blackRatio < 0.3) {
    return []
  }

  if (input.blackRatio >= 0.95) {
    return [
      {
        code: 'visual.smoke.black_screen',
        message: `Rendered video is mostly black (${formatPercent(input.blackRatio)} black frames).`,
        severity: 'error',
      },
    ]
  }

  return [
    {
      code: 'visual.smoke.high_black_ratio',
      message: `Rendered video has a high black-frame ratio (${formatPercent(input.blackRatio)}).`,
      severity: 'warning',
    },
  ]
}

function checkBlackDurationWithoutRatio(input: VisualSmokeInput): QualityIssue[] {
  if (input.blackRatio !== undefined || input.blackDuration <= 0) {
    return []
  }

  return [
    {
      code: 'visual.smoke.black_detected',
      message: `Rendered video contains ${input.blackDuration}s of black frames, but total duration was unavailable.`,
      severity: 'warning',
    },
  ]
}

function checkFrameSamples(frameSamples: VisualFrameSample[]): QualityIssue[] {
  const sampleIssues = frameSamples.flatMap((frameSample) => {
    if (!frameSample.ok) {
      return [
        {
          code: 'visual.frame_sample.failed',
          message: frameSample.error === undefined ? `Rendered video frame sample at ${frameSample.timestamp}s could not be generated.` : `Rendered video frame sample at ${frameSample.timestamp}s could not be generated: ${frameSample.error}`,
          severity: 'warning' as const,
        },
      ]
    }

    if (frameSample.size === undefined || frameSample.size <= 0) {
      return [
        {
          code: 'visual.frame_sample.empty',
          message: `Rendered video frame sample at ${frameSample.timestamp}s is empty.`,
          severity: 'warning' as const,
        },
      ]
    }

    return []
  })
  const successfulHashes = frameSamples
    .filter((frameSample) => frameSample.ok && frameSample.sha256 !== undefined)
    .map((frameSample) => frameSample.sha256)

  if (successfulHashes.length >= 2 && new Set(successfulHashes).size === 1) {
    return [
      ...sampleIssues,
      {
        code: 'visual.frame_sample.static',
        message: `Rendered video frame samples appear identical across ${successfulHashes.length} capture points.`,
        severity: 'warning',
      },
    ]
  }

  return sampleIssues
}

function normalizeFrameSamples(input: VisualSmokeInput): VisualFrameSample[] {
  return input.frameSamples ?? (input.frameSample === undefined ? [] : [input.frameSample])
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}
