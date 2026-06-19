import {expect} from '#test/expect'

import {deckCanvasSize} from '../../../packages/renderer-deck/src/deck/format.js'

describe('deckCanvasSize', () => {
  it('returns 1920x1080 for landscape format', () => {
    const size = deckCanvasSize('landscape_1920x1080')

    expect(size.width).to.equal(1920)
    expect(size.height).to.equal(1080)
  })

  it('returns 1080x1920 for portrait format', () => {
    const size = deckCanvasSize('portrait_1080x1920')

    expect(size.width).to.equal(1080)
    expect(size.height).to.equal(1920)
  })

  it('returns 1080x1080 for square format', () => {
    const size = deckCanvasSize('square_1080x1080')

    expect(size.width).to.equal(1080)
    expect(size.height).to.equal(1080)
  })
})
