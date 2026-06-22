import {expect} from '#test/expect'

import {createDeckSourceMap} from '../../../packages/pipeline-deck/src/planning/source-map.js'

describe('Deck source map', () => {
  it('does not infer a source title from Markdown headings', () => {
    const sourceMap = createDeckSourceMap({
      inputPath: '/tmp/source.md',
      language: 'en',
      sourceType: 'markdown',
      text: '# Runtime Heading\n\nThe body explains the workflow.',
    })

    expect(sourceMap.title).to.equal(undefined)
    expect(sourceMap.source.title).to.equal(undefined)
    expect(sourceMap.sections[0]).to.deep.include({
      kind: 'heading',
      text: 'Runtime Heading',
    })
  })

  it('preserves an explicit source title', () => {
    const sourceMap = createDeckSourceMap({
      inputPath: '/tmp/source.md',
      language: 'en',
      sourceType: 'markdown',
      text: '# Runtime Heading\n\nThe body explains the workflow.',
      title: 'Explicit Deck Title',
    })

    expect(sourceMap.title).to.equal('Explicit Deck Title')
    expect(sourceMap.source.title).to.equal('Explicit Deck Title')
  })

  it('rejects blank explicit titles instead of falling back to headings', () => {
    expect(() => createDeckSourceMap({
      inputPath: '/tmp/source.md',
      language: 'en',
      sourceType: 'markdown',
      text: '# Runtime Heading\n\nThe body explains the workflow.',
      title: '   ',
    })).to.throw('no source heading title inference fallback is allowed')
  })

  it('rejects empty source text instead of creating a synthetic section range', () => {
    expect(() => createDeckSourceMap({
      inputPath: '/tmp/source.md',
      language: 'en',
      sourceType: 'markdown',
      text: '   ',
    })).to.throw('no synthetic source section fallback is allowed')
  })
})
