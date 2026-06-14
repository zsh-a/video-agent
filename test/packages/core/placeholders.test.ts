import {expect} from 'chai'

import type {ClipPlanItem, NarrationSegment, TimelineItem} from '../../../packages/ir/src/index.js'

import {
  createClipPlan,
  createNarrationFromClipPlan,
  createPlaceholderStoryboard,
  createPlaceholderTimeline,
  createTimelineFromClipPlan,
} from '../../../packages/core/src/placeholders.js'

describe('placeholder IR', () => {
  const mediaInfo = {
    duration: 12.5,
    inputPath: '/tmp/input.mp4',
    probedAt: '2026-06-14T00:00:00.000Z',
    streams: [
      {
        fps: 24,
        index: 0,
        type: 'video' as const,
      },
    ],
    version: 1 as const,
  }

  it('creates a storyboard with one scene covering the media duration', () => {
    const storyboard = createPlaceholderStoryboard(mediaInfo)

    expect(storyboard.version).to.equal(1)
    expect(storyboard.scenes).to.have.length(1)
    expect(storyboard.scenes[0].duration).to.equal(12.5)
  })

  it('creates a video timeline using source media and fps', () => {
    const timeline = createPlaceholderTimeline(mediaInfo)

    expect(timeline.duration).to.equal(12.5)
    expect(timeline.fps).to.equal(24)
    expect(timeline.items[0]).to.include({
      duration: 12.5,
      source: '/tmp/input.mp4',
      track: 'video',
    })
  })

  it('creates a sequential clip plan and derives timeline source ranges from it', () => {
    const storyboard = {
      language: 'zh-CN',
      scenes: [
        {
          duration: 5,
          evidence: [],
          id: 'scene-1',
          start: 0,
          visualStyle: 'documentary',
        },
        {
          duration: 10,
          evidence: [],
          id: 'scene-2',
          start: 8,
          visualStyle: 'documentary',
        },
      ],
      targetPlatform: 'generic' as const,
      version: 1 as const,
    }
    const clipPlan = createClipPlan(storyboard, mediaInfo)
    const timeline = createTimelineFromClipPlan(mediaInfo, clipPlan)

    expect(clipPlan.clips.map((clip: ClipPlanItem) => clip.sourceRange)).to.deep.equal([
      [0, 5],
      [5, 12.5],
    ])
    expect(timeline.items.map((item: TimelineItem) => item.sourceRange)).to.deep.equal([
      [0, 5],
      [5, 12.5],
    ])
    expect(timeline.duration).to.equal(15.5)
    expect(timeline.items.map((item: TimelineItem) => item.duration)).to.deep.equal([5, 7.5])
    expect(clipPlan.clips[1].reason).to.equal('Sequential source range for scene-2; requested 10s, allocated 7.5s.')
  })

  it('keeps source ranges monotonic when storyboard scene starts overlap', () => {
    const storyboard = {
      language: 'zh-CN',
      scenes: [
        {
          duration: 4,
          evidence: [],
          id: 'scene-1',
          start: 0,
          visualStyle: 'documentary',
        },
        {
          duration: 4,
          evidence: [],
          id: 'scene-2',
          start: 2,
          visualStyle: 'documentary',
        },
      ],
      targetPlatform: 'generic' as const,
      version: 1 as const,
    }
    const clipPlan = createClipPlan(storyboard, mediaInfo)

    expect(clipPlan.clips.map((clip: ClipPlanItem) => clip.sourceRange)).to.deep.equal([
      [0, 4],
      [4, 8],
    ])
    expect(clipPlan.duration).to.equal(6)
  })

  it('creates narration timing from allocated clip plan durations', () => {
    const storyboard = {
      language: 'zh-CN',
      scenes: [
        {
          duration: 5,
          evidence: [],
          id: 'scene-1',
          narration: 'Opening beat.',
          start: 0,
          visualStyle: 'documentary',
        },
        {
          duration: 10,
          evidence: [],
          id: 'scene-2',
          narration: 'Follow-up beat.',
          start: 8,
          visualStyle: 'documentary',
        },
      ],
      targetPlatform: 'generic' as const,
      version: 1 as const,
    }
    const clipPlan = createClipPlan(storyboard, mediaInfo)
    const narration = createNarrationFromClipPlan(storyboard, clipPlan)

    expect(
      narration.segments.map((segment: NarrationSegment) => ({
        duration: segment.duration,
        sceneId: segment.sceneId,
        start: segment.start,
        text: segment.text,
      })),
    ).to.deep.equal([
      {
        duration: 5,
        sceneId: 'scene-1',
        start: 0,
        text: 'Opening beat.',
      },
      {
        duration: 7.5,
        sceneId: 'scene-2',
        start: 8,
        text: 'Follow-up beat.',
      },
    ])
  })
})
