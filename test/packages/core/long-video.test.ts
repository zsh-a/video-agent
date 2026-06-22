import {expect} from '#test/expect'

import {createLongVideoChunkPlan, DEFAULT_LONG_VIDEO_CHUNK_OPTIONS} from '../../../packages/core/src/index.js'

describe('long video chunk planning', () => {
  const mediaInfo = {
    duration: 12.5,
    inputPath: '/tmp/long.mp4',
    probedAt: '2026-06-16T00:00:00.000Z',
    streams: [
      {
        fps: 30,
        index: 0,
        type: 'video' as const,
      },
    ],
    version: 1 as const,
  }

  it('creates chunk-first ranges with overlap analysis context', () => {
    const plan = createLongVideoChunkPlan(mediaInfo, {
      chunkDuration: 5,
      chunkOverlap: 1,
      vlmBatchSize: 8,
    })

    expect(plan).to.include({
      source: '/tmp/long.mp4',
      sourceDuration: 12.5,
      version: 1,
    })
    expect(plan.defaults).to.deep.equal({
      ...DEFAULT_LONG_VIDEO_CHUNK_OPTIONS,
      chunkDuration: 5,
      chunkOverlap: 1,
      vlmBatchSize: 8,
    })
    expect(plan.chunks.map((chunk) => ({
      analysisRange: chunk.analysisRange,
      artifactPrefix: chunk.artifactPrefix,
      contentRange: chunk.contentRange,
      duration: chunk.duration,
      id: chunk.id,
      index: chunk.index,
    }))).to.deep.equal([
      {
        analysisRange: [0, 6],
        artifactPrefix: 'chunks/000',
        contentRange: [0, 5],
        duration: 5,
        id: 'chunk-000',
        index: 0,
      },
      {
        analysisRange: [4, 11],
        artifactPrefix: 'chunks/001',
        contentRange: [5, 10],
        duration: 5,
        id: 'chunk-001',
        index: 1,
      },
      {
        analysisRange: [9, 12.5],
        artifactPrefix: 'chunks/002',
        contentRange: [10, 12.5],
        duration: 2.5,
        id: 'chunk-002',
        index: 2,
      },
    ])
  })

  it('uses the long-video default parameters', () => {
    const plan = createLongVideoChunkPlan({
      ...mediaInfo,
      duration: 601,
    })

    expect(plan.defaults).to.deep.equal(DEFAULT_LONG_VIDEO_CHUNK_OPTIONS)
    expect(plan.chunks.map((chunk) => chunk.contentRange)).to.deep.equal([
      [0, 300],
      [300, 600],
      [600, 601],
    ])
    expect(plan.chunks.map((chunk) => chunk.analysisRange)).to.deep.equal([
      [0, 310],
      [290, 601],
      [590, 601],
    ])
  })

  it('rejects unknown media duration instead of returning an empty chunk plan', () => {
    expect(() => createLongVideoChunkPlan({
      inputPath: '/tmp/live.mp4',
      probedAt: '2026-06-16T00:00:00.000Z',
      streams: [],
      version: 1,
    })).to.throw('no empty chunk-plan fallback is allowed')
  })

  it('rejects explicit zero media duration instead of falling back to stream duration', () => {
    expect(() => createLongVideoChunkPlan({
      duration: 0,
      inputPath: '/tmp/zero.mp4',
      probedAt: '2026-06-16T00:00:00.000Z',
      streams: [
        {
          duration: 12,
          fps: 30,
          index: 0,
          type: 'video',
        },
      ],
      version: 1,
    })).to.throw('positive media duration')
  })

  it('uses stream duration when container duration is unavailable', () => {
    const plan = createLongVideoChunkPlan({
      inputPath: '/tmp/stream-duration.mp4',
      probedAt: '2026-06-16T00:00:00.000Z',
      streams: [
        {
          duration: 12,
          fps: 30,
          index: 0,
          type: 'video',
        },
        {
          duration: 10,
          index: 1,
          type: 'audio',
        },
      ],
      version: 1,
    }, {
      chunkDuration: 5,
      chunkOverlap: 1,
    })

    expect(plan.sourceDuration).to.equal(12)
    expect(plan.chunks.map((chunk) => chunk.contentRange)).to.deep.equal([
      [0, 5],
      [5, 10],
      [10, 12],
    ])
  })

  it('rejects invalid chunk defaults', () => {
    let error: unknown

    try {
      createLongVideoChunkPlan(mediaInfo, {
        chunkDuration: 0,
      })
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
  })
})
