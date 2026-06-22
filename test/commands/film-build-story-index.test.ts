import {expect} from '#test/expect'

import FilmBuildStoryIndex from '../../src/commands/film/build-story-index.js'

describe('film build-story-index command', () => {
  it('does not default semantic language in the adapter', () => {
    const languageFlag = FilmBuildStoryIndex.flags.language as {default?: string}

    expect(languageFlag.default).to.equal(undefined)
  })
})
