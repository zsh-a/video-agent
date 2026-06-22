import {expect} from '#test/expect'

import {
  DEFAULT_DECK_FRAME_CONCURRENCY,
  DEFAULT_DECK_FRAME_SHARD_SIZE,
  DEFAULT_DECK_RENDER_FPS,
  createDeckFrameShardRanges,
  normalizeDeckFrameConcurrency,
  normalizeDeckFrameRange,
  normalizeDeckFrameShardSize,
  normalizeDeckRendererFps,
  normalizeDeckShardConcurrency,
  normalizeDeckShardRetries,
  normalizeDeckShardRetryDelayMs,
} from '../../../packages/pipeline-deck/src/render/frames/options.js'

describe('Deck frame option validation', () => {
  it('uses defaults only when optional values are omitted', () => {
    expect(normalizeDeckFrameConcurrency(undefined)).to.equal(DEFAULT_DECK_FRAME_CONCURRENCY)
    expect(normalizeDeckFrameShardSize(undefined)).to.equal(DEFAULT_DECK_FRAME_SHARD_SIZE)
    expect(normalizeDeckRendererFps(undefined)).to.equal(DEFAULT_DECK_RENDER_FPS)
    expect(normalizeDeckShardConcurrency(undefined)).to.equal(1)
    expect(normalizeDeckShardRetries(undefined)).to.equal(0)
    expect(normalizeDeckShardRetryDelayMs(undefined)).to.equal(0)
  })

  it('rejects positive integer options instead of coercing them', () => {
    expect(() => normalizeDeckFrameConcurrency(0)).to.throw('Deck frame concurrency must be a positive integer; no runtime integer coercion fallback is allowed. Received: 0')
    expect(() => normalizeDeckFrameShardSize(1.5)).to.throw('Deck frame shard size must be a positive integer; no runtime integer coercion fallback is allowed. Received: 1.5')
    expect(() => normalizeDeckRendererFps(Number.NaN)).to.throw('Deck renderer fps must be a positive integer; no runtime integer coercion fallback is allowed. Received: NaN')
    expect(() => normalizeDeckShardConcurrency(-1)).to.throw('Deck shard concurrency must be a positive integer; no runtime integer coercion fallback is allowed. Received: -1')
  })

  it('rejects non-negative integer options instead of coercing them', () => {
    expect(() => normalizeDeckShardRetries(-1)).to.throw('Deck shard retries must be a non-negative integer; no runtime integer coercion fallback is allowed. Received: -1')
    expect(() => normalizeDeckShardRetryDelayMs(2.5)).to.throw('Deck shard retry delay ms must be a non-negative integer; no runtime integer coercion fallback is allowed. Received: 2.5')
  })

  it('rejects invalid frame ranges instead of flooring or clamping', () => {
    expect(normalizeDeckFrameRange({frameEnd: 4, frameStart: 2})).to.deep.equal({end: 4, start: 2})
    expect(() => normalizeDeckFrameRange({frameStart: 0})).to.throw('Deck frameStart must be a positive integer; no runtime integer coercion fallback is allowed. Received: 0')
    expect(() => normalizeDeckFrameRange({frameEnd: 3.5})).to.throw('Deck frameEnd must be a positive integer; no runtime integer coercion fallback is allowed. Received: 3.5')
    expect(() => normalizeDeckFrameRange({frameEnd: 2, frameStart: 4})).to.throw('Deck frameEnd (2) must be greater than or equal to frameStart (4).')
  })

  it('creates shard ranges only for valid positive integer inputs', () => {
    expect(createDeckFrameShardRanges(5, 2)).to.deep.equal([
      {end: 2, start: 1},
      {end: 4, start: 3},
      {end: 5, start: 5},
    ])
    expect(() => createDeckFrameShardRanges(0, 2)).to.throw('Deck frame count must be a positive integer; no runtime integer coercion fallback is allowed. Received: 0')
    expect(() => createDeckFrameShardRanges(5, 1.5)).to.throw('Deck frame shard size must be a positive integer; no runtime integer coercion fallback is allowed. Received: 1.5')
  })
})
