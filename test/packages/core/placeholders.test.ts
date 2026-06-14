import {expect} from 'chai'

import {createClipPlan, createPlaceholderStoryboard, createPlaceholderTimeline, createTimelineFromClipPlan} from '../../../packages/core/src/placeholders.js'

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

  it('creates a clip plan and derives timeline source ranges from it', () => {
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

    expect(clipPlan.clips.map((clip) => clip.sourceRange)).to.deep.equal([
      [0, 5],
      [8, 12.5],
    ])
    expect(timeline.items.map((item) => item.sourceRange)).to.deep.equal([
      [0, 5],
      [8, 12.5],
    ])
    expect(timeline.items.map((item) => item.duration)).to.deep.equal([5, 4.5])
  })
})
