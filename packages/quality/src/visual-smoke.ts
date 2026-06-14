import type {QualityIssue} from './timeline.js'

export interface VisualSmokeInput {
  blackDuration: number
  blackRatio?: number
  blackSegments: VisualBlackSegment[]
  duration?: number
  frameSample?: VisualFrameSample
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
  issues: QualityIssue[]
  probed: boolean
  warnings: number
}

export interface VisualFrameSample {
  capturedAt: string
  error?: string
  ok: boolean
  path?: string
  size?: number
  timestamp: number
}

export function checkVisualSmoke(input: VisualSmokeInput): VisualSmokeQualityResult {
  const issues = [...checkBlackRatio(input), ...checkBlackDurationWithoutRatio(input), ...checkFrameSample(input.frameSample)]

  return {
    blackDuration: input.blackDuration,
    ...(input.blackRatio === undefined ? {} : {blackRatio: input.blackRatio}),
    blackSegments: input.blackSegments,
    ...(input.duration === undefined ? {} : {duration: input.duration}),
    errors: issues.filter((issue) => issue.severity === 'error').length,
    ...(input.frameSample === undefined ? {} : {frameSample: input.frameSample}),
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
  const issues = [...result.issues, ...checkFrameSample(frameSample)]

  return {
    ...result,
    errors: issues.filter((issue) => issue.severity === 'error').length,
    frameSample,
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

function checkFrameSample(frameSample: undefined | VisualFrameSample): QualityIssue[] {
  if (frameSample === undefined) {
    return []
  }

  if (!frameSample.ok) {
    return [
      {
        code: 'visual.frame_sample.failed',
        message: frameSample.error === undefined ? 'Rendered video first-frame sample could not be generated.' : `Rendered video first-frame sample could not be generated: ${frameSample.error}`,
        severity: 'warning',
      },
    ]
  }

  if (frameSample.size === undefined || frameSample.size <= 0) {
    return [
      {
        code: 'visual.frame_sample.empty',
        message: 'Rendered video first-frame sample is empty.',
        severity: 'warning',
      },
    ]
  }

  return []
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}
