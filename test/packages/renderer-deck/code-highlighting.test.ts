import {expect} from '#test/expect'

import {highlightDeckCodeBlocks} from '../../../packages/renderer-deck/src/deck/code-highlighting.js'

describe('highlightDeckCodeBlocks', () => {
  it('does not synthesize code blocks from code-slide title or points', async () => {
    const highlights = await highlightDeckCodeBlocks({
      format: 'landscape_1920x1080',
      inputMode: 'script-generated',
      language: 'en-US',
      slides: [
        {
          blockIds: [],
          evidence: [],
          motion: 'blur-rise',
          points: ['Do not treat this point as source code'],
          slideId: 'slide-code',
          title: 'Code slide without code',
          type: 'code',
          visual: {assetRefs: [], kind: 'code'},
        },
      ],
      theme: 'elegant-dark',
      title: 'No Synthetic Code',
      version: 1,
    })

    expect(highlights.size).to.equal(0)
  })

  it('rejects unsupported code languages instead of falling back to plain text', async () => {
    let error: unknown

    try {
      await highlightDeckCodeBlocks({
        format: 'landscape_1920x1080',
        inputMode: 'script-generated',
        language: 'en-US',
        slides: [
          {
            blockIds: [],
            code: {
              language: 'not-a-real-language',
              text: 'bun run test',
            },
            evidence: [],
            motion: 'blur-rise',
            points: [],
            slideId: 'slide-code',
            title: 'Code slide',
            type: 'code',
            visual: {assetRefs: [], kind: 'code'},
          },
        ],
        theme: 'elegant-dark',
        title: 'Unsupported Code',
        version: 1,
      })
    } catch (caught) {
      error = caught
    }

    expect(String(error)).to.include('Unsupported Deck code block language')
  })
})
