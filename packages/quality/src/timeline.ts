import type {Timeline} from '@video-agent/ir'

export interface QualityIssue {
  code: string
  message: string
  severity: 'error' | 'warning'
}

export function checkTimelineBounds(timeline: Timeline): QualityIssue[] {
  return timeline.items
    .filter((item) => item.start + item.duration > timeline.duration)
    .map((item) => ({
      code: 'timeline.item.out_of_bounds',
      message: `Timeline item ${item.id} exceeds project duration.`,
      severity: 'error',
    }))
}
