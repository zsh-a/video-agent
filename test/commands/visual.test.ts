import {expect} from '#test/expect'

import {formatVisualSample} from '../../src/utils/visual-output.js'

describe('visual command', () => {
  it('formats visual samples for terminal output', () => {
    expect(
      formatVisualSample({
        exists: true,
        ok: true,
        relativePath: 'renders/final-frame-first.jpg',
        size: 123,
        timestamp: 0,
      }),
    ).to.equal('0s\tok\trenders/final-frame-first.jpg\t123')
  })

  it('formats missing visual samples with errors', () => {
    expect(
      formatVisualSample({
        error: 'Visual sample file is missing.',
        exists: false,
        ok: false,
        relativePath: 'renders/missing.jpg',
        timestamp: 1,
      }),
    ).to.equal('1s\tmissing\trenders/missing.jpg\t0\tVisual sample file is missing.')
  })
})
