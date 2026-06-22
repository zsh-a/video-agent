import {expect} from '#test/expect'

import {createFrameSampleTimes} from '../../../packages/runtime/src/render/quality.js'

describe('runtime render quality', () => {
  it('plans visual frame samples only for explicit positive durations', () => {
    expect(createFrameSampleTimes()).to.deep.equal([{label: 'first', timestamp: 0}])
    expect(createFrameSampleTimes(0.2)).to.deep.equal([{label: 'first', timestamp: 0}])
    expect(createFrameSampleTimes(2)).to.deep.equal([
      {label: 'first', timestamp: 0},
      {label: 'middle', timestamp: 1},
      {label: 'end', timestamp: 1.9},
    ])

    expect(() => createFrameSampleTimes(0)).to.throw('Rendered visual inspection duration must be a positive finite number when provided; no frame-sample duration fallback is allowed. Received: 0')
    expect(() => createFrameSampleTimes(Number.NaN)).to.throw('Rendered visual inspection duration must be a positive finite number when provided; no frame-sample duration fallback is allowed. Received: NaN')
  })
})
