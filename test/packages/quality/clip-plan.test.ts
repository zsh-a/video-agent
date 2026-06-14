import {expect} from 'chai'

import {checkClipPlanConsistency} from '../../../packages/quality/src/clip-plan.js'

describe('clip plan quality', () => {
  it('passes when clip ranges and timeline video items match', () => {
    expect(checkClipPlanConsistency(createClipPlan(), createTimeline())).to.deep.equal([])
  })

  it('reports invalid clip source ranges and duration mismatches', () => {
    const clipPlan = createClipPlan({
      clips: [
        {
          duration: 3,
          id: 'clip-1',
          sceneId: 'scene-1',
          source: '/tmp/input.mp4',
          sourceRange: [8, 12],
          start: 0,
        },
      ],
      duration: 2,
      sourceDuration: 10,
    })

    expect(checkClipPlanConsistency(clipPlan, createTimeline()).map((issue) => issue.code)).to.include.members([
      'clip_plan.clip.out_of_bounds',
      'clip_plan.duration_mismatch',
      'clip_plan.source_range.out_of_bounds',
      'clip_plan.timeline_duration_mismatch',
      'clip_plan.timeline_item_mismatch',
    ])
  })

  it('reports timeline item count and item mismatches', () => {
    const timeline = createTimeline({
      items: [
        {
          duration: 4,
          id: 'video-1',
          source: '/tmp/other.mp4',
          sourceRange: [1, 5],
          start: 0,
          track: 'video',
        },
        {
          duration: 1,
          id: 'video-2',
          source: '/tmp/input.mp4',
          sourceRange: [5, 6],
          start: 4,
          track: 'video',
        },
      ],
    })

    expect(checkClipPlanConsistency(createClipPlan(), timeline).map((issue) => issue.code)).to.deep.equal([
      'clip_plan.timeline_item_count_mismatch',
      'clip_plan.timeline_item_mismatch',
    ])
  })
})

function createClipPlan(overrides: Partial<ReturnType<typeof baseClipPlan>> = {}): ReturnType<typeof baseClipPlan> {
  return {
    ...baseClipPlan(),
    ...overrides,
  }
}

function baseClipPlan() {
  return {
    clips: [
      {
        duration: 4,
        id: 'clip-1',
        sceneId: 'scene-1',
        source: '/tmp/input.mp4',
        sourceRange: [0, 4] as [number, number],
        start: 0,
      },
    ],
    duration: 4,
    source: '/tmp/input.mp4',
    sourceDuration: 10,
    version: 1 as const,
  }
}

function createTimeline(overrides: Partial<ReturnType<typeof baseTimeline>> = {}): ReturnType<typeof baseTimeline> {
  return {
    ...baseTimeline(),
    ...overrides,
  }
}

function baseTimeline() {
  return {
    duration: 4,
    fps: 30,
    items: [
      {
        duration: 4,
        id: 'video-1',
        source: '/tmp/input.mp4',
        sourceRange: [0, 4] as [number, number],
        start: 0,
        track: 'video' as const,
      },
    ],
    version: 1 as const,
  }
}
