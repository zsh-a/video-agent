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

  it('rejects invalid transcript scene boundary segments instead of filtering or clipping them', () => {
    expect(() => createSceneBoundariesFromTranscript({
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
    }, 12.5)).to.throw('no segment clipping or filtering is allowed')
  })

  it('rejects transcript scene boundary planning without positive media duration instead of using transcript timestamps as duration', () => {
    expect(() => createSceneBoundariesFromTranscript({
      segments: [
        {
          end: 5,
          start: 0,
          text: 'Timed transcript exists.',
        },
      ],
      text: 'Timed transcript exists.',
    }, 0)).to.throw('no transcript timestamp duration fallback is allowed')
  })

  it('rejects storyboard scenes without explicit source ranges instead of deriving ranges by position', () => {
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

    expect(() => createClipPlan(storyboard, mediaInfo)).to.throw('explicit sourceRange')
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
    expect(clipPlan.clips[1].reason).to.equal(undefined)
  })

  it('rejects timeline planning without probed video fps instead of defaulting to 30fps', () => {
    const storyboard = {
      language: 'zh-CN',
      scenes: [
        {
          duration: 4,
          evidence: [],
          id: 'scene-1',
          sourceRange: [0, 4] as [number, number],
          start: 0,
          visualStyle: 'documentary',
        },
      ],
      targetPlatform: 'generic' as const,
      version: 1 as const,
    }
    const missingFpsMediaInfo = {
      duration: 12.5,
      inputPath: '/tmp/no-fps.mp4',
      probedAt: '2026-06-14T00:00:00.000Z',
      streams: [
        {
          index: 0,
          type: 'video' as const,
        },
      ],
      version: 1 as const,
    }
    const clipPlan = createClipPlan(storyboard, missingFpsMediaInfo)

    expect(() => createTimelineFromClipPlan(missingFpsMediaInfo, clipPlan)).to.throw('no 30fps renderer fallback is allowed')
  })

  it('rejects timeline planning without a video stream instead of defaulting to 30fps', () => {
    const storyboard = {
      language: 'zh-CN',
      scenes: [
        {
          duration: 4,
          evidence: [],
          id: 'scene-1',
          sourceRange: [0, 4] as [number, number],
          start: 0,
          visualStyle: 'documentary',
        },
      ],
      targetPlatform: 'generic' as const,
      version: 1 as const,
    }
    const audioOnlyMediaInfo = {
      duration: 12.5,
      inputPath: '/tmp/audio-only.wav',
      probedAt: '2026-06-14T00:00:00.000Z',
      streams: [
        {
          index: 0,
          type: 'audio' as const,
        },
      ],
      version: 1 as const,
    }
    const clipPlan = createClipPlan(storyboard, audioOnlyMediaInfo)

    expect(() => createTimelineFromClipPlan(audioOnlyMediaInfo, clipPlan)).to.throw('positive video stream fps')
  })

  it('rejects storyboard source ranges outside media duration instead of clipping them', () => {
    const storyboard = {
      language: 'zh-CN',
      scenes: [
        {
          duration: 14,
          evidence: [],
          id: 'scene-1',
          sourceRange: [0, 14] as [number, number],
          start: 0,
          visualStyle: 'documentary',
        },
      ],
      targetPlatform: 'generic' as const,
      version: 1 as const,
    }

    expect(() => createClipPlan(storyboard, mediaInfo)).to.throw('no runtime sourceRange clipping is allowed')
  })

  it('rejects clip planning without media or stream duration', () => {
    const storyboard = {
      language: 'zh-CN',
      scenes: [
        {
          duration: 1,
          evidence: [],
          id: 'scene-1',
          sourceRange: [0, 1] as [number, number],
          start: 0,
          visualStyle: 'documentary',
        },
      ],
      targetPlatform: 'generic' as const,
      version: 1 as const,
    }

    expect(() => createClipPlan(storyboard, {
      inputPath: '/tmp/no-duration.mp4',
      probedAt: '2026-06-14T00:00:00.000Z',
      streams: [],
      version: 1,
    })).to.throw('no zero-duration clip-plan fallback is allowed')
  })

  it('rejects explicit zero media duration instead of falling back to stream duration for clip planning', () => {
    const storyboard = {
      language: 'zh-CN',
      scenes: [
        {
          duration: 1,
          evidence: [],
          id: 'scene-1',
          sourceRange: [0, 1] as [number, number],
          start: 0,
          visualStyle: 'documentary',
        },
      ],
      targetPlatform: 'generic' as const,
      version: 1 as const,
    }

    expect(() => createClipPlan(storyboard, {
      duration: 0,
      inputPath: '/tmp/zero-duration.mp4',
      probedAt: '2026-06-14T00:00:00.000Z',
      streams: [{duration: 12, fps: 24, index: 0, type: 'video'}],
      version: 1,
    })).to.throw('positive media duration')
  })

  it('uses explicit source ranges even when storyboard scene starts overlap', () => {
    const storyboard = {
      language: 'zh-CN',
      scenes: [
        {
          duration: 4,
          evidence: [],
          id: 'scene-1',
          sourceRange: [0, 4] as [number, number],
          start: 0,
          visualStyle: 'documentary',
        },
        {
          duration: 4,
          evidence: [],
          id: 'scene-2',
          sourceRange: [4, 8] as [number, number],
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

  it('rejects transcript boundary planning without timed segments instead of creating a full transcript scene', () => {
    expect(() => createSceneBoundariesFromTranscript({
      text: 'Only raw transcript text is available.',
    }, 12.5)).to.throw('timed transcript segments')
  })

})
