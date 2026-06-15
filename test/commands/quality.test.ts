import {expect} from '#test/expect'

import {formatQualityRenderSummary} from '../../src/commands/quality.js'

describe('quality command', () => {
  it('formats all render diagnostic categories', () => {
    expect(formatQualityRenderSummary({
      audioInputs: 1,
      audioQualityErrors: 1,
      audioQualityWarnings: 2,
      audioWarnings: 3,
      missingVoiceovers: 4,
      outputErrors: 5,
      outputWarnings: 6,
      rendered: true,
      renderer: 'ffmpeg',
      subtitleErrors: 7,
      subtitleWarnings: 8,
      templateErrors: 9,
      templateWarnings: 10,
      visualErrors: 11,
      visualWarnings: 12,
    })).to.equal('rendered, 33 errors, 45 warnings, output 5/6, subtitle 7/8, audio 1/9, template 9/10, visual 11/12')
  })
})
