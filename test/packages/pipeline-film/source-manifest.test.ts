import {expect} from '#test/expect'

import type {MediaInfo} from '../../../packages/ir/src/index.js'

import {createSourceManifest} from '../../../packages/pipeline-film/src/planning/source.js'

describe('Film source manifest', () => {
  it('uses stream duration only when container duration is missing', () => {
    const manifest = createSourceManifest({
      inputPath: '/tmp/source.mp4',
      probedAt: '2026-06-21T00:00:00.000Z',
      streams: [
        {
          duration: 12,
          fps: 30,
          height: 720,
          type: 'video',
          width: 1280,
        },
      ],
      version: 1,
    }, 'source-hash')

    expect(manifest.duration).to.equal(12)
  })

  it('rejects missing probed duration instead of creating a zero-duration manifest', () => {
    const mediaInfo: MediaInfo = {
      inputPath: '/tmp/source.mp4',
      probedAt: '2026-06-21T00:00:00.000Z',
      streams: [{height: 720, type: 'video', width: 1280}],
      version: 1,
    }

    expect(() => createSourceManifest(mediaInfo, 'source-hash')).to.throw('no zero-duration source fallback is allowed')
  })

  it('rejects explicit zero duration instead of falling back to stream duration', () => {
    const mediaInfo: MediaInfo = {
      duration: 0,
      inputPath: '/tmp/source.mp4',
      probedAt: '2026-06-21T00:00:00.000Z',
      streams: [{duration: 12, height: 720, type: 'video', width: 1280}],
      version: 1,
    }

    expect(() => createSourceManifest(mediaInfo, 'source-hash')).to.throw('positive media duration')
  })
})
