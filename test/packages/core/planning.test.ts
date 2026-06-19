import {expect} from '#test/expect'

import type {ClipPlanItem, TimelineItem} from '../../../packages/ir/src/index.js'

import {
  createClipPlan,
  createSceneBoundariesFromTranscript,
  createTimelineFromClipPlan,
} from '../../../packages/core/src/planning.js'

describe('core planning helpers', () => {
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

  it('uses stream duration when container duration is unavailable', () => {
    const streamDurationMediaInfo = {
      inputPath: '/tmp/stream-duration.mp4',
      probedAt: '2026-06-14T00:00:00.000Z',
      streams: [
        {
          duration: 12,
          fps: 24,
          index: 0,
          type: 'video' as const,
        },
      ],
      version: 1 as const,
    }
    const storyboard = {
      language: 'zh-CN',
      scenes: [
        {
          duration: 12,
          evidence: [],
          id: 'scene-1',
          sourceRange: [0, 12] as [number, number],
          start: 0,
          visualStyle: 'documentary',
        },
      ],
      targetPlatform: 'generic' as const,
      version: 1 as const,
    }
    const clipPlan = createClipPlan(storyboard, streamDurationMediaInfo)
    const timeline = createTimelineFromClipPlan(streamDurationMediaInfo, clipPlan)

    expect(storyboard.scenes[0].sourceRange).to.deep.equal([0, 12])
    expect(clipPlan).to.include({
      duration: 12,
      sourceDuration: 12,
    })
    expect(clipPlan.clips[0]).to.include({
      duration: 12,
    })
    expect(timeline).to.include({
      duration: 12,
    })
  })

  it('keeps generated scene boundary ids contiguous after filtering invalid transcript segments', () => {
    const boundaries = createSceneBoundariesFromTranscript({
      segments: [
        {
          end: 0,
          start: 0,
          text: 'Invalid intro.',
        },
        {
          end: 5,
          start: 1,
          text: 'Valid middle.',
        },
        {
          end: 20,
          start: 5,
          text: 'Clamped ending.',
        },
      ],
      text: 'Invalid intro. Valid middle. Clamped ending.',
    }, 12.5)

    expect(boundaries).to.deep.equal([
      {
        end: 5,
        id: 'scene-1',
        start: 1,
        text: 'Valid middle.',
      },
      {
        end: 12.5,
        id: 'scene-2',
        start: 5,
        text: 'Clamped ending.',
      },
    ])
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

  it('uses storyboard source ranges for transcript-derived scenes', () => {
    const storyboard = {
      language: 'zh-CN',
      scenes: [
        {
          duration: 4,
          evidence: [],
          id: 'scene-1',
          sourceRange: [1, 5] as [number, number],
          start: 0,
          visualStyle: 'documentary',
        },
        {
          duration: 4.5,
          evidence: [],
          id: 'scene-2',
          sourceRange: [8, 12.5] as [number, number],
          start: 4,
          visualStyle: 'documentary',
        },
      ],
      targetPlatform: 'generic' as const,
      version: 1 as const,
    }
    const clipPlan = createClipPlan(storyboard, mediaInfo)
    const timeline = createTimelineFromClipPlan(mediaInfo, clipPlan)

    expect(storyboard.scenes.map((scene) => scene.sourceRange)).to.deep.equal([
      [1, 5],
      [8, 12.5],
    ])
    expect(clipPlan.clips.map((clip: ClipPlanItem) => clip.sourceRange)).to.deep.equal([
      [1, 5],
      [8, 12.5],
    ])
    expect(timeline.items.map((item: TimelineItem) => item.sourceRange)).to.deep.equal([
      [1, 5],
      [8, 12.5],
    ])
    expect(clipPlan.clips.map((clip: ClipPlanItem) => clip.duration)).to.deep.equal([4, 4.5])
    expect(clipPlan.clips[1].reason).to.equal('Storyboard source range for scene-2; requested 4.5s, allocated 4.5s.')
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

})
