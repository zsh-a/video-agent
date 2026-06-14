import type {QualityIssue} from './timeline.js'

export interface VisualSmokeInput {
  blackDuration: number
  blackRatio?: number
  blackSegments: VisualBlackSegment[]
  duration?: number
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
  issues: QualityIssue[]
  probed: boolean
  warnings: number
}

export function checkVisualSmoke(input: VisualSmokeInput): VisualSmokeQualityResult {
  const issues = [...checkBlackRatio(input), ...checkBlackDurationWithoutRatio(input)]

  return {
    blackDuration: input.blackDuration,
    ...(input.blackRatio === undefined ? {} : {blackRatio: input.blackRatio}),
    blackSegments: input.blackSegments,
    ...(input.duration === undefined ? {} : {duration: input.duration}),
    errors: issues.filter((issue) => issue.severity === 'error').length,
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

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}
