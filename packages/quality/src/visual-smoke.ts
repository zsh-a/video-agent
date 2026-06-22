import type {QualityIssue} from './timeline.js'

import {QUALITY_ERROR_SEVERITY, QUALITY_WARNING_SEVERITY, countQualityIssues} from './issues.js'

export interface VisualSmokeInput {
  blackDuration: number
  blackRatio?: number
  blackSegments: VisualBlackSegment[]
  duration?: number
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
  const issues = [...checkBlackRatio(input), ...checkBlackDurationWithoutRatio(input), ...checkFrameSamples(frameSamples, input.duration)]

  return {
    blackDuration: input.blackDuration,
    ...(input.blackRatio === undefined ? {} : {blackRatio: input.blackRatio}),
    blackSegments: input.blackSegments,
    ...(input.duration === undefined ? {} : {duration: input.duration}),
    ...countQualityIssues(issues),
    ...(frameSamples.length === 0 ? {} : {frameSamples}),
    issues,
    probed: true,
  }
}

export function createVisualSmokeProbeFailure(message: string): VisualSmokeQualityResult {
  const issues: QualityIssue[] = [
    {
      code: 'visual.smoke.probe_failed',
      message,
      severity: QUALITY_WARNING_SEVERITY,
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
  const existingSamples = result.frameSamples ?? []
  const nextSamples = [...existingSamples, ...frameSamples]
  const issues = [...result.issues, ...checkFrameSamples(frameSamples, result.duration)]

  return {
    ...result,
    ...countQualityIssues(issues),
    frameSamples: nextSamples,
    issues,
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
        severity: QUALITY_ERROR_SEVERITY,
      },
    ]
  }

  return [
    {
      code: 'visual.smoke.high_black_ratio',
      message: `Rendered video has a high black-frame ratio (${formatPercent(input.blackRatio)}).`,
      severity: QUALITY_WARNING_SEVERITY,
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
      severity: QUALITY_WARNING_SEVERITY,
    },
  ]
}

function checkFrameSamples(frameSamples: VisualFrameSample[], duration: number | undefined): QualityIssue[] {
  const sampleIssues = frameSamples.flatMap((frameSample) => {
    if (duration !== undefined && (frameSample.timestamp < 0 || frameSample.timestamp > duration + 0.05)) {
      return [
        {
          code: 'visual.frame_sample.out_of_bounds',
          message: `Rendered video frame sample at ${frameSample.timestamp}s is outside the rendered duration (${duration}s).`,
          severity: QUALITY_WARNING_SEVERITY,
        },
      ]
    }

    if (!frameSample.ok) {
      return [
        {
          code: 'visual.frame_sample.failed',
          message: frameSample.error === undefined ? `Rendered video frame sample at ${frameSample.timestamp}s could not be generated.` : `Rendered video frame sample at ${frameSample.timestamp}s could not be generated: ${frameSample.error}`,
          severity: QUALITY_WARNING_SEVERITY,
        },
      ]
    }

    if (frameSample.size === undefined || frameSample.size <= 0) {
      return [
        {
          code: 'visual.frame_sample.empty',
          message: `Rendered video frame sample at ${frameSample.timestamp}s is empty.`,
          severity: QUALITY_WARNING_SEVERITY,
        },
      ]
    }

    return []
  })
  const successfulHashes = frameSamples
    .filter((frameSample) => frameSample.ok && frameSample.sha256 !== undefined)
    .map((frameSample) => frameSample.sha256)
  const successfulSizes = frameSamples
    .filter((frameSample) => frameSample.ok && frameSample.size !== undefined && frameSample.size > 0)
    .map((frameSample) => frameSample.size as number)

  if (successfulHashes.length >= 2 && new Set(successfulHashes).size === 1) {
    return [
      ...sampleIssues,
      {
        code: 'visual.frame_sample.static',
        message: `Rendered video frame samples appear identical across ${successfulHashes.length} capture points.`,
        severity: QUALITY_WARNING_SEVERITY,
      },
    ]
  }

  if (hasLowSampleSizeVariation(successfulSizes)) {
    return [
      ...sampleIssues,
      {
        code: 'visual.frame_sample.low_variation',
        message: `Rendered video frame samples have very low byte-size variation across ${successfulSizes.length} capture points.`,
        severity: QUALITY_WARNING_SEVERITY,
      },
    ]
  }

  return sampleIssues
}

function hasLowSampleSizeVariation(sizes: number[]): boolean {
  if (sizes.length < 3) {
    return false
  }

  const min = Math.min(...sizes)
  const max = Math.max(...sizes)

  if (max <= 0) {
    return false
  }

  return (max - min) / max <= 0.005
}

function normalizeFrameSamples(input: VisualSmokeInput): VisualFrameSample[] {
  return input.frameSamples ?? []
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}
