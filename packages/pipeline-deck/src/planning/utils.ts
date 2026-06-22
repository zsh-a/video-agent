import {DECK_THEMES, type Deck, type MediaInfo, type SlideTiming, type TimedDeck} from '@video-agent/ir'
export const DECK_THEME_DESCRIPTIONS: Record<string, string> = {
  'elegant-dark': '深色科技风，适合技术、AI、数据、编程主题',
  'clean-white': '简洁白净，适合商业汇报、教育、通用主题',
  'finance-terminal': '终端绿色风，适合金融、加密货币、数据终端主题',
  'tech-gradient': '蓝紫渐变，适合前沿科技、创新、未来感主题',
  'minimal-editorial': '暖色纸张风，适合人文、编辑、出版、学术主题',
  'warm-paper': '暖橙纸张风，适合生活、文化、温暖、故事性主题',
}

export function cleanGeneratedText(value: string | undefined, field: string): string {
  const raw = value ?? ''

  assertNoGeneratedTextWhitespaceRepair(raw, field)

  return raw
}

function assertNoGeneratedTextWhitespaceRepair(value: string, field: string): void {
  if (value !== value.trim()) {
    throw new Error(`LLM Deck plan ${field} contains leading or trailing whitespace. Rewrite the field in LLM output; no runtime whitespace trim is allowed.`)
  }

  if (/[\r\n\t]/u.test(value)) {
    throw new Error(`LLM Deck plan ${field} contains layout whitespace. Rewrite the field in LLM output; no runtime whitespace repair is allowed.`)
  }

  if (/[^\S\r\n]{2,}/u.test(value)) {
    throw new Error(`LLM Deck plan ${field} contains repeated whitespace. Rewrite the field in LLM output; no runtime whitespace repair is allowed.`)
  }
}

export function assertNoGeneratedTextControlSyntax(value: string, field: string): void {
  const normalized = value.replaceAll(/\r\n?/g, '\n')

  if (/^---\n[\s\S]*?\n---(?:\n|$)/u.test(normalized)) {
    throw new Error(`LLM Deck plan ${field} contains YAML frontmatter. Rewrite the field in LLM output; no runtime Markdown cleanup is allowed.`)
  }

  if (/```/u.test(normalized)) {
    throw new Error(`LLM Deck plan ${field} contains Markdown code fences. Rewrite the field in LLM output; no runtime Markdown cleanup is allowed.`)
  }

  if (/^第\s*\d+\s*页[：:]/u.test(normalized.trim())) {
    throw new Error(`LLM Deck plan ${field} contains a page-number prefix. Rewrite the field in LLM output; no runtime page-prefix cleanup is allowed.`)
  }

  const lines = normalized.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    if (/^#{1,6}\s+/u.test(trimmed) || /^[-*+]\s+/u.test(trimmed) || /^>\s*/u.test(trimmed) || trimmed === '---') {
      throw new Error(`LLM Deck plan ${field} contains Markdown control syntax. Rewrite the field in LLM output; no runtime Markdown cleanup is allowed.`)
    }

    if (trimmed.includes('|')) {
      throw new Error(`LLM Deck plan ${field} contains Markdown table syntax. Rewrite the field in LLM output; no runtime Markdown cleanup is allowed.`)
    }
  }
}

export function createTextMediaInfo(inputPath: string, duration: number): MediaInfo {
  return {
    duration,
    formatName: 'text/plain',
    inputPath,
    probedAt: new Date().toISOString(),
    streams: [],
    version: 1,
  }
}

export function normalizeDeckTheme(theme: string): Deck['theme'] {
  if (DECK_THEMES.includes(theme as Deck['theme'])) {
    return theme as Deck['theme']
  }

  throw new Error(`Unsupported deck theme "${theme}". Expected one of: ${DECK_THEMES.join(', ')}.`)
}

export function resolveTheme(llmTheme: Deck['theme'], optionTheme: string | undefined): Deck['theme'] {
  if (optionTheme !== undefined && optionTheme !== 'auto') {
    return normalizeDeckTheme(optionTheme)
  }

  return llmTheme
}

export function createTimedDeck(deck: Deck, timings: SlideTiming[]): TimedDeck {
  return {
    deck,
    timings,
    version: 1,
  }
}
