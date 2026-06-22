import type {QualityIssueSeverity, Timeline} from '@video-agent/ir'

import {QUALITY_ERROR_SEVERITY} from './issues.js'

export interface QualityIssue {
  code: string
  message: string
  severity: QualityIssueSeverity
}

export function checkTimelineBounds(timeline: Timeline): QualityIssue[] {
  return timeline.items
    .filter((item) => item.start + item.duration > timeline.duration)
    .map((item) => ({
      code: 'timeline.item.out_of_bounds',
      message: `Timeline item ${item.id} exceeds project duration.`,
      severity: QUALITY_ERROR_SEVERITY,
    }))
}
