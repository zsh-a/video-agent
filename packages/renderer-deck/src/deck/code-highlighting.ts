import type {Deck, DeckCodeBlock, DeckSlideType} from '@video-agent/ir'
import type {BundledLanguage, BundledTheme} from 'shiki'

import {bundledLanguages, bundledLanguagesAlias, codeToHtml} from 'shiki'

import {codeHighlightKey, normalizeCodeLanguage, type CodeHighlightMap} from './components/code-highlight-context.js'

const SHIKI_THEME = 'github-dark-default' satisfies BundledTheme
const SHIKI_FALLBACK_LANGUAGE = 'text' as BundledLanguage
const CODE_RENDERING_TEMPLATES = new Set<DeckSlideType>(['code'])

export async function highlightDeckCodeBlocks(deck: Deck): Promise<CodeHighlightMap> {
  const blocks = deck.slides
    .filter((slide) => CODE_RENDERING_TEMPLATES.has(slide.type) || slide.code !== undefined)
    .map((slide): DeckCodeBlock => slide.code ?? {
      language: 'text',
      text: slide.points.join('\n') || slide.title,
    })

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

  return SHIKI_FALLBACK_LANGUAGE
}
