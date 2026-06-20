import type {Deck, DeckCodeBlock} from '@video-agent/ir'
import type {BundledLanguage, BundledTheme} from 'shiki'

import {bundledLanguages, bundledLanguagesAlias, codeToHtml} from 'shiki'

import {codeHighlightKey, normalizeCodeLanguage, type CodeHighlightMap} from './components/code-highlight-context.js'

const SHIKI_THEME = 'github-dark-default' satisfies BundledTheme

export async function highlightDeckCodeBlocks(deck: Deck): Promise<CodeHighlightMap> {
  const blocks = deck.slides
    .filter((slide): slide is Deck['slides'][number] & {code: DeckCodeBlock} => slide.code !== undefined)
    .map((slide): DeckCodeBlock => slide.code)

  if (blocks.length === 0) {
    return new Map()
  }

  const highlights = new Map<string, string>()

  await Promise.all(blocks.map(async (block) => {
    const key = codeHighlightKey(block)

    if (highlights.has(key)) {
      return
    }

    highlights.set(key, await highlightDeckCodeBlock(block))
  }))

  return highlights
}

async function highlightDeckCodeBlock(code: DeckCodeBlock): Promise<string> {
  return codeToHtml(code.text, {
    lang: shikiLanguageFor(code.language),
    theme: SHIKI_THEME,
  })
}

function shikiLanguageFor(language: string): BundledLanguage {
  const normalized = normalizeCodeLanguage(language)

  if (normalized in bundledLanguages) {
    return normalized as BundledLanguage
  }

  if (normalized in bundledLanguagesAlias) {
    return normalized as BundledLanguage
  }

  throw new Error(`Unsupported Deck code block language "${language}". Use an explicit Shiki-supported language or alias.`)
}
