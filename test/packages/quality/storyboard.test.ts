import {expect} from 'chai'

import {checkStoryboardConsistency} from '../../../packages/quality/src/storyboard.js'

describe('storyboard quality', () => {
  it('passes for source ranges that match scene timing and media duration', () => {
    expect(checkStoryboardConsistency(createStoryboard(), createMediaInfo())).to.deep.equal([])
  })

  it('reports source range bounds and duration issues', () => {
    const storyboard = createStoryboard({
      scenes: [
        {
          duration: 4,
          evidence: [],
          id: 'scene-1',
          sourceRange: [1, 6] as [number, number],
          start: 0,
          visualStyle: 'documentary',
        },
        {
          duration: 3,
          evidence: [],
          id: 'scene-2',
          sourceRange: [8, 12] as [number, number],
          start: 8,
          visualStyle: 'documentary',
        },
      ],
    })

    expect(checkStoryboardConsistency(storyboard, createMediaInfo()).map((issue) => `${issue.code}:${issue.severity}`)).to.deep.equal([
      'storyboard.scene.source_range.duration_mismatch:error',
      'storyboard.scene.out_of_bounds:warning',
      'storyboard.scene.source_range.out_of_bounds:error',
      'storyboard.scene.source_range.duration_mismatch:error',
    ])
  })
})

function createMediaInfo() {
  return {
    duration: 10,
    inputPath: '/tmp/input.mp4',
    probedAt: '2026-06-15T00:00:00.000Z',
    streams: [],
    version: 1 as const,
  }
}

function createStoryboard(overrides: Partial<ReturnType<typeof baseStoryboard>> = {}): ReturnType<typeof baseStoryboard> {
  return {
    ...baseStoryboard(),
    ...overrides,
  }
}

function baseStoryboard() {
  return {
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
}
