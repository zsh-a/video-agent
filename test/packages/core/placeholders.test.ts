import {expect} from 'chai'

import type {ClipPlanItem, NarrationSegment, StoryboardScene, TimelineItem} from '../../../packages/ir/src/index.js'

import {
  createClipPlan,
  createNarrationFromClipPlan,
  createPlaceholderStoryboard,
  createPlaceholderTimeline,
  createSceneBoundariesFromTranscript,
  createStoryboardFromProviderInsights,
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

  it('creates storyboard scenes from transcript segments and visual analysis', () => {
    const storyboard = createStoryboardFromProviderInsights(mediaInfo, {
      sceneAnalysis: [
        {
          description: 'A wide establishing shot.',
          evidence: ['frame_00001.jpg'],
          sceneId: 'scene-1',
        },
        {
          description: 'A detail shot of the subject.',
          evidence: ['frame_00006.jpg'],
          sceneId: 'scene-2',
        },
      ],
      transcript: {
        language: 'en',
        segments: [
          {
            end: 5,
            start: 0,
            text: 'Opening narration.',
          },
          {
            end: 12.5,
            start: 5,
            text: 'Second beat narration.',
          },
        ],
        text: 'Opening narration. Second beat narration.',
      },
    })

    expect(storyboard.language).to.equal('en')
    expect(storyboard.scenes).to.have.length(2)
    expect(storyboard.scenes.map((scene: StoryboardScene) => ({
      duration: scene.duration,
      narration: scene.narration,
      sourceRange: scene.sourceRange,
      start: scene.start,
    }))).to.deep.equal([
      {
        duration: 5,
        narration: 'Opening narration.',
        sourceRange: [0, 5],
        start: 0,
      },
      {
        duration: 7.5,
        narration: 'Second beat narration.',
        sourceRange: [5, 12.5],
        start: 5,
      },
    ])
    expect(storyboard.scenes[0].evidence).to.deep.equal([
      {
        ref: 'transcript.json',
        text: 'Opening narration.',
        type: 'asr',
      },
      {
        ref: 'scene-analysis.json',
        text: 'A wide establishing shot.',
        type: 'vlm',
      },
    ])
  })

  it('falls back to one full-duration storyboard scene when transcript segments have no duration', () => {
    const storyboard = createStoryboardFromProviderInsights(mediaInfo, {
      sceneAnalysis: [
        {
          description: 'Fallback visual description.',
          evidence: [],
          sceneId: 'scene-1',
        },
      ],
      transcript: {
        language: 'zh-CN',
        segments: [
          {
            end: 0,
            start: 0,
            text: 'Zero-length transcript segment.',
          },
        ],
        text: 'Whole clip narration.',
      },
    })

    expect(storyboard.scenes).to.have.length(1)
    expect(storyboard.scenes[0]).to.include({
      duration: 12.5,
      narration: 'Whole clip narration.',
      start: 0,
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
    const storyboard = createStoryboardFromProviderInsights(mediaInfo, {
      transcript: {
        segments: [
          {
            end: 5,
            start: 1,
            text: 'Middle opening.',
          },
          {
            end: 20,
            start: 8,
            text: 'Clamped ending.',
          },
        ],
        text: 'Middle opening. Clamped ending.',
      },
    })
    const clipPlan = createClipPlan(storyboard, mediaInfo)
    const timeline = createTimelineFromClipPlan(mediaInfo, clipPlan)

    expect(storyboard.scenes.map((scene: StoryboardScene) => scene.sourceRange)).to.deep.equal([
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
