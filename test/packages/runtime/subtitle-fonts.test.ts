import {expect} from '#test/expect'

import {findCjkSubtitleFont, isReliableCjkSubtitleFontPath} from '../../../packages/runtime/src/subtitle-fonts.js'

describe('runtime subtitle fonts', () => {
  it('accepts Source Han Sans CN as a reliable CJK subtitle font', () => {
    expect(isReliableCjkSubtitleFontPath('/usr/share/fonts/adobe-source-han-sans/SourceHanSansCN-Regular.otf')).to.equal(true)
  })

  it('rejects generic fontconfig fallback fonts', () => {
    expect(isReliableCjkSubtitleFontPath('/usr/share/fonts/gnu-free/FreeSans.otf')).to.equal(false)
  })

  it('continues past an unreliable Noto match and selects Source Han Sans CN', async () => {
    const font = await findCjkSubtitleFont(async (family) => {
      if (family === 'Noto Sans CJK SC') {
        return '/usr/share/fonts/gnu-free/FreeSans.otf'
      }

      if (family === 'Source Han Sans CN') {
        return '/usr/share/fonts/adobe-source-han-sans/SourceHanSansCN-Regular.otf'
      }

      return undefined
    })

    expect(font).to.deep.equal({
      family: 'Source Han Sans CN',
      path: '/usr/share/fonts/adobe-source-han-sans/SourceHanSansCN-Regular.otf',
    })
  })
})
