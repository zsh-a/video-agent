import {expect} from '#test/expect'

import {checkRenderedMedia, createRenderedMediaProbeFailure} from '../../../packages/quality/src/index.js'

describe('rendered media quality', () => {
  it('passes when rendered media has video and matching duration', () => {
    const result = checkRenderedMedia(
      {
        duration: 1,
        inputPath: '/tmp/output.mp4',
        probedAt: '2026-01-01T00:00:00.000Z',
        streams: [
          {
            index: 0,
            type: 'video',
          },
          {
            index: 1,
            type: 'subtitle',
          },
        ],
        version: 1,
      },
      {
        expectedDuration: 1.1,
      },
    )

    expect(result).to.deep.equal({
      audioStreams: 0,
      duration: 1,
      errors: 0,
      issues: [],
      probed: true,
      subtitleStreams: 1,
      videoStreams: 1,
      warnings: 0,
    })
  })

  it('reports missing streams and duration mismatch', () => {
    const result = checkRenderedMedia(
      {
        duration: 3,
        inputPath: '/tmp/output.mp4',
        probedAt: '2026-01-01T00:00:00.000Z',
        streams: [],
        version: 1,
      },
      {
        expectAudio: true,
        expectedDuration: 1,
      },
    )

    expect(result.errors).to.equal(1)
    expect(result.warnings).to.equal(2)
    expect(result.issues.map((issue) => issue.code)).to.deep.equal(['render.output.missing_video', 'render.output.missing_audio', 'render.output.duration_mismatch'])
  })

  it('reports broken video stream timing even when container duration matches', () => {
    const result = checkRenderedMedia(
      {
        duration: 165.6,
        inputPath: '/tmp/output.mp4',
        probedAt: '2026-01-01T00:00:00.000Z',
        streams: [
          {
            duration: 74.88,
            fps: 0.053,
            index: 0,
            type: 'video',
          },
          {
            duration: 165.6,
            index: 1,
            type: 'audio',
          },
        ],
        version: 1,
      },
      {
        expectAudio: true,
        expectedDuration: 165.6,
      },
    )

    expect(result.errors).to.equal(0)
    expect(result.warnings).to.equal(2)
    expect(result.issues.map((issue) => issue.code)).to.deep.equal(['render.output.video_duration_mismatch', 'render.output.low_video_fps'])
  })

  it('creates a probe failure warning', () => {
    expect(createRenderedMediaProbeFailure('ffprobe failed')).to.deep.equal({
      audioStreams: 0,
      errors: 0,
      issues: [
        {
          code: 'render.output.probe_failed',
          message: 'ffprobe failed',
          severity: 'warning',
        },
      ],
      probed: false,
      subtitleStreams: 0,
      videoStreams: 0,
      warnings: 1,
    })
  })
})
