import {expect} from 'chai'

import {createPlaceholderStoryboard, createPlaceholderTimeline} from '../../../packages/core/src/placeholders.js'

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
})
