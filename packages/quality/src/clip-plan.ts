import type {ClipPlan, Timeline, TimelineItem} from '@video-agent/ir'

import type {QualityIssue} from './timeline.js'

export interface ClipPlanQualityOptions {
  timingTolerance?: number
}

export function checkClipPlanConsistency(clipPlan: ClipPlan, timeline: Timeline, options: ClipPlanQualityOptions = {}): QualityIssue[] {
  const tolerance = options.timingTolerance ?? 0.05
  const issues: QualityIssue[] = []
  const videoItems = timeline.items.filter((item): item is TimelineItem & {source: string} => item.track === 'video' && item.source !== undefined)

  if (Math.abs(timeline.duration - clipPlan.duration) > tolerance) {
    issues.push({
      code: 'clip_plan.timeline_duration_mismatch',
      message: 'Clip plan duration differs from timeline duration.',
      severity: 'error',
    })
  }

  if (videoItems.length !== clipPlan.clips.length) {
    issues.push({
      code: 'clip_plan.timeline_item_count_mismatch',
      message: `Clip plan has ${clipPlan.clips.length} clip(s), but timeline has ${videoItems.length} video item(s).`,
      severity: 'error',
    })
  }

  let previousClip: ClipPlan['clips'][number] | undefined

  for (const [index, clip] of clipPlan.clips.entries()) {
    const [sourceStart, sourceEnd] = clip.sourceRange
    const sourceDuration = sourceEnd - sourceStart

    if (previousClip !== undefined && previousClip.source === clip.source) {
      const previousSourceEnd = previousClip.sourceRange[1]

      if (sourceStart < previousSourceEnd - tolerance) {
        issues.push({
          code: 'clip_plan.source_range.overlap',
          message: `Clip ${clip.id} source range overlaps ${previousClip.id}.`,
          severity: 'error',
        })
      }

      if (sourceStart > previousSourceEnd + tolerance) {
        issues.push({
          code: 'clip_plan.source_range.gap',
          message: `Clip ${clip.id} skips unused source media after ${previousClip.id}.`,
          severity: 'warning',
        })
      }
    }

    if (sourceEnd < sourceStart) {
      issues.push({
        code: 'clip_plan.source_range.invalid',
        message: `Clip ${clip.id} has an invalid source range.`,
        severity: 'error',
      })
    }

    if (sourceEnd > clipPlan.sourceDuration + tolerance) {
      issues.push({
        code: 'clip_plan.source_range.out_of_bounds',
        message: `Clip ${clip.id} exceeds source media duration.`,
        severity: 'error',
      })
    }

    if (Math.abs(sourceDuration - clip.duration) > tolerance) {
      issues.push({
        code: 'clip_plan.duration_mismatch',
        message: `Clip ${clip.id} duration differs from its source range.`,
        severity: 'error',
      })
    }

    if (clip.start + clip.duration > clipPlan.duration + tolerance) {
      issues.push({
        code: 'clip_plan.clip.out_of_bounds',
        message: `Clip ${clip.id} exceeds clip plan duration.`,
        severity: 'error',
      })
    }

    const videoItem = videoItems[index]

    if (videoItem !== undefined && !matchesTimelineItem(clip, videoItem, tolerance)) {
      issues.push({
        code: 'clip_plan.timeline_item_mismatch',
        message: `Timeline item ${videoItem.id} does not match clip ${clip.id}.`,
        severity: 'error',
      })
    }

    previousClip = clip
  }

  return issues
}

function matchesTimelineItem(clip: ClipPlan['clips'][number], item: TimelineItem & {source: string}, tolerance: number): boolean {
  return (
    item.source === clip.source &&
    Math.abs(item.start - clip.start) <= tolerance &&
    Math.abs(item.duration - clip.duration) <= tolerance &&
    item.sourceRange !== undefined &&
    Math.abs(item.sourceRange[0] - clip.sourceRange[0]) <= tolerance &&
    Math.abs(item.sourceRange[1] - clip.sourceRange[1]) <= tolerance
  )
}
