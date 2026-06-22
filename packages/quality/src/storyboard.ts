import type {MediaInfo, Storyboard} from '@video-agent/ir'

import type {QualityIssue} from './timeline.js'

import {QUALITY_ERROR_SEVERITY, QUALITY_WARNING_SEVERITY} from './issues.js'

export interface StoryboardQualityOptions {
  timingTolerance?: number
}

export function checkStoryboardConsistency(storyboard: Storyboard, mediaInfo: MediaInfo, options: StoryboardQualityOptions = {}): QualityIssue[] {
  const tolerance = options.timingTolerance ?? 0.05
  const issues: QualityIssue[] = []
  const mediaDuration = mediaInfo.duration

  if (mediaDuration === undefined) {
    issues.push({
      code: 'storyboard.media.duration_missing',
      message: 'Storyboard quality requires probed media duration; no zero-duration media fallback is allowed.',
      severity: QUALITY_ERROR_SEVERITY,
    })
  }

  for (const scene of storyboard.scenes) {
    if (scene.duration <= 0) {
      issues.push({
        code: 'storyboard.scene.duration_invalid',
        message: `Scene ${scene.id} duration must be positive.`,
        severity: QUALITY_ERROR_SEVERITY,
      })
    }

    if (mediaDuration !== undefined && scene.start + scene.duration > mediaDuration + tolerance) {
      issues.push({
        code: 'storyboard.scene.out_of_bounds',
        message: `Scene ${scene.id} exceeds source media duration.`,
        severity: QUALITY_WARNING_SEVERITY,
      })
    }

    if (scene.sourceRange !== undefined && scene.sourceRange[1] <= scene.sourceRange[0]) {
      issues.push({
        code: 'storyboard.scene.source_range.invalid',
        message: `Scene ${scene.id} has an invalid source range.`,
        severity: QUALITY_ERROR_SEVERITY,
      })
    }

    const timingRange = scene.outputRange ?? scene.sourceRange

    if (timingRange === undefined) {
      continue
    }

    const [rangeStart, rangeEnd] = timingRange
    const rangeDuration = rangeEnd - rangeStart
    const rangeKind = scene.outputRange === undefined ? 'source_range' : 'output_range'
    const rangeLabel = scene.outputRange === undefined ? 'source range' : 'output range'

    if (rangeEnd <= rangeStart) {
      issues.push({
        code: `storyboard.scene.${rangeKind}.invalid`,
        message: `Scene ${scene.id} has an invalid ${rangeLabel}.`,
        severity: QUALITY_ERROR_SEVERITY,
      })
    }

    if (mediaDuration !== undefined && rangeEnd > mediaDuration + tolerance) {
      issues.push({
        code: `storyboard.scene.${rangeKind}.out_of_bounds`,
        message: `Scene ${scene.id} ${rangeLabel} exceeds media duration.`,
        severity: QUALITY_ERROR_SEVERITY,
      })
    }

    if (Math.abs(rangeDuration - scene.duration) > tolerance) {
      issues.push({
        code: `storyboard.scene.${rangeKind}.duration_mismatch`,
        message: `Scene ${scene.id} duration differs from its ${rangeLabel}.`,
        severity: QUALITY_ERROR_SEVERITY,
      })
    }
  }

  return issues
}
