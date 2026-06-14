import {expect} from 'chai'

import {addVisualFrameSample, checkVisualSmoke, createVisualSmokeProbeFailure} from '../../../packages/quality/src/index.js'

describe('visual smoke quality', () => {
  it('passes when black-frame ratio is low', () => {
    expect(
      checkVisualSmoke({
        blackDuration: 0.1,
        blackRatio: 0.05,
        blackSegments: [
          {
            duration: 0.1,
            end: 0.1,
            start: 0,
          },
        ],
        duration: 2,
      }),
    ).to.deep.equal({
      blackDuration: 0.1,
      blackRatio: 0.05,
      blackSegments: [
        {
          duration: 0.1,
          end: 0.1,
          start: 0,
        },
      ],
      duration: 2,
      errors: 0,
      issues: [],
      probed: true,
      warnings: 0,
    })
  })

  it('warns for a high black-frame ratio and errors for mostly black output', () => {
    expect(
      checkVisualSmoke({
        blackDuration: 1,
        blackRatio: 0.5,
        blackSegments: [],
        duration: 2,
      }).issues.map((issue) => issue.code),
    ).to.deep.equal(['visual.smoke.high_black_ratio'])
    expect(
      checkVisualSmoke({
        blackDuration: 1.95,
        blackRatio: 0.975,
        blackSegments: [],
        duration: 2,
      }).issues.map((issue) => issue.code),
    ).to.deep.equal(['visual.smoke.black_screen'])
  })

  it('warns when black frames are detected without total duration', () => {
    expect(
      checkVisualSmoke({
        blackDuration: 0.4,
        blackSegments: [],
      }).issues.map((issue) => issue.code),
    ).to.deep.equal(['visual.smoke.black_detected'])
  })

  it('records first-frame samples and warns when sampling fails', () => {
    const result = addVisualFrameSample(
      checkVisualSmoke({
        blackDuration: 0,
        blackSegments: [],
        duration: 1,
      }),
      {
        capturedAt: '2026-01-01T00:00:00.000Z',
        ok: true,
        path: '/tmp/final-first-frame.jpg',
        size: 123,
        timestamp: 0,
      },
    )

    expect(result.frameSample).to.deep.equal({
      capturedAt: '2026-01-01T00:00:00.000Z',
      ok: true,
      path: '/tmp/final-first-frame.jpg',
      size: 123,
      timestamp: 0,
    })
    expect(result.issues).to.deep.equal([])

    expect(
      addVisualFrameSample(
        checkVisualSmoke({
          blackDuration: 0,
          blackSegments: [],
        }),
        {
          capturedAt: '2026-01-01T00:00:00.000Z',
          error: 'ffmpeg failed',
          ok: false,
          path: '/tmp/final-first-frame.jpg',
          timestamp: 0,
        },
      ).issues.map((issue) => issue.code),
    ).to.deep.equal(['visual.frame_sample.failed'])
  })

  it('creates a probe failure warning', () => {
    expect(createVisualSmokeProbeFailure('ffmpeg failed')).to.deep.equal({
      blackDuration: 0,
      blackSegments: [],
      errors: 0,
      issues: [
        {
          code: 'visual.smoke.probe_failed',
          message: 'ffmpeg failed',
          severity: 'warning',
        },
      ],
      probed: false,
      warnings: 1,
    })
  })
})
