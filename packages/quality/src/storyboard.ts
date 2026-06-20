import type {MediaInfo, Storyboard} from '@video-agent/ir'

import type {QualityIssue} from './timeline.js'

export interface StoryboardQualityOptions {
  timingTolerance?: number
}

export function checkStoryboardConsistency(storyboard: Storyboard, mediaInfo: MediaInfo, options: StoryboardQualityOptions = {}): QualityIssue[] {
  const tolerance = options.timingTolerance ?? 0.05
  const issues: QualityIssue[] = []
  const mediaDuration = mediaInfo.duration ?? 0

  for (const scene of storyboard.scenes) {
    if (scene.duration <= 0) {
      issues.push({
        code: 'storyboard.scene.duration_invalid',
        message: `Scene ${scene.id} duration must be positive.`,
        severity: 'error',
      })
    }

    if (scene.start + scene.duration > mediaDuration + tolerance) {
      issues.push({
        code: 'storyboard.scene.out_of_bounds',
        message: `Scene ${scene.id} exceeds source media duration.`,
        severity: 'warning',
      })
    }

    if (scene.sourceRange !== undefined && scene.sourceRange[1] < scene.sourceRange[0]) {
      issues.push({
        code: 'storyboard.scene.source_range.invalid',
        message: `Scene ${scene.id} has an invalid source range.`,
        severity: 'error',
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

    if (rangeEnd < rangeStart) {
      issues.push({
        code: `storyboard.scene.${rangeKind}.invalid`,
        message: `Scene ${scene.id} has an invalid ${rangeLabel}.`,
        severity: 'error',
      })
    }

    if (rangeEnd > mediaDuration + tolerance) {
      issues.push({
        code: `storyboard.scene.${rangeKind}.out_of_bounds`,
        message: `Scene ${scene.id} ${rangeLabel} exceeds media duration.`,
        severity: 'error',
      })
    }

    if (Math.abs(rangeDuration - scene.duration) > tolerance) {
      issues.push({
        code: `storyboard.scene.${rangeKind}.duration_mismatch`,
        message: `Scene ${scene.id} duration differs from its ${rangeLabel}.`,
        severity: 'error',
      })
    }
  }

  return issues
}
