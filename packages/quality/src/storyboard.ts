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

    if (scene.sourceRange === undefined) {
      continue
    }

    const [sourceStart, sourceEnd] = scene.sourceRange
    const sourceDuration = sourceEnd - sourceStart

    if (sourceEnd < sourceStart) {
      issues.push({
        code: 'storyboard.scene.source_range.invalid',
        message: `Scene ${scene.id} has an invalid source range.`,
        severity: 'error',
      })
    }

    if (sourceEnd > mediaDuration + tolerance) {
      issues.push({
        code: 'storyboard.scene.source_range.out_of_bounds',
        message: `Scene ${scene.id} source range exceeds source media duration.`,
        severity: 'error',
      })
    }

    if (Math.abs(sourceDuration - scene.duration) > tolerance) {
      issues.push({
        code: 'storyboard.scene.source_range.duration_mismatch',
        message: `Scene ${scene.id} duration differs from its source range.`,
        severity: 'error',
      })
    }
  }

  return issues
}
