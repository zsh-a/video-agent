import {expect} from '#test/expect'

import {checkAudioLoudness, createAudioLoudnessProbeFailure} from '../../../packages/quality/src/index.js'

describe('audio loudness quality', () => {
  it('passes moderate loudness', () => {
    expect(checkAudioLoudness({maxVolumeDb: -1, meanVolumeDb: -18})).to.deep.equal({
      errors: 0,
      issues: [],
      maxVolumeDb: -1,
      meanVolumeDb: -18,
      probed: true,
      warnings: 0,
    })
  })

  it('warns for quiet, loud, clipping, and unavailable loudness data', () => {
    expect(checkAudioLoudness({maxVolumeDb: -2, meanVolumeDb: -40}).issues.map((issue) => issue.code)).to.deep.equal(['audio.loudness.quiet'])
    expect(checkAudioLoudness({maxVolumeDb: -2, meanVolumeDb: -6}).issues.map((issue) => issue.code)).to.deep.equal(['audio.loudness.loud'])
    expect(checkAudioLoudness({maxVolumeDb: -0.1, meanVolumeDb: -18}).issues.map((issue) => issue.code)).to.deep.equal(['audio.loudness.clipping_risk'])
    expect(checkAudioLoudness({}).issues.map((issue) => issue.code)).to.deep.equal(['audio.loudness.unavailable'])
  })

  it('creates a probe failure warning', () => {
    expect(createAudioLoudnessProbeFailure('ffmpeg failed')).to.deep.equal({
      errors: 0,
      issues: [
        {
          code: 'audio.loudness.probe_failed',
          message: 'ffmpeg failed',
          severity: 'warning',
        },
      ],
      probed: false,
      warnings: 1,
    })
  })
})
