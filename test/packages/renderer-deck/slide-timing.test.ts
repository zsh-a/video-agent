import {expect} from '#test/expect'

import {slideTiming} from '../../../packages/renderer-deck/src/deck/motion/helpers.js'

describe('slideTiming', () => {
  it('returns fast config for short slides (< 20s)', () => {
    const timing = slideTiming(15)

    expect(timing.enterAt).to.equal(0.04)
    expect(timing.contentAt).to.equal(0.14)
    expect(timing.emphasisAt).to.equal(0.65)
  })

  it('returns normal config for medium slides (20-30s)', () => {
    const timing = slideTiming(25)

    expect(timing.enterAt).to.equal(0.06)
    expect(timing.contentAt).to.equal(0.18)
    expect(timing.emphasisAt).to.equal(0.72)
  })

  it('returns slow config for long slides (> 30s)', () => {
    const timing = slideTiming(35)

    expect(timing.enterAt).to.equal(0.08)
    expect(timing.contentAt).to.equal(0.22)
    expect(timing.emphasisAt).to.equal(0.78)
  })

  it('fast contentAt is earlier than normal', () => {
    const fast = slideTiming(15)
    const normal = slideTiming(25)

    expect(fast.contentAt).to.be.lessThan(normal.contentAt)
  })

  it('slow contentAt is later than normal', () => {
    const slow = slideTiming(35)
    const normal = slideTiming(25)

    expect(slow.contentAt).to.be.greaterThan(normal.contentAt)
  })

  it('all timing values are valid numbers', () => {
    for (const duration of [10, 15, 20, 25, 30, 35, 40]) {
      const timing = slideTiming(duration)

      expect(typeof timing.enterAt).to.equal('number')
      expect(typeof timing.contentAt).to.equal('number')
      expect(typeof timing.emphasisAt).to.equal('number')
      expect(typeof timing.titleDuration(duration)).to.equal('number')
      expect(typeof timing.contentDuration(duration)).to.equal('number')
    }
  })
})
