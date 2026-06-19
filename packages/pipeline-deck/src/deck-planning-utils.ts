import type {Deck, DeckSlideType, DeckVisual, MediaInfo, Slide, SlideTiming, TimedDeck} from '@video-agent/ir'

export const DEFAULT_DECK_THEME: Deck['theme'] = 'elegant-dark'
export const DECK_THEMES = ['auto', 'elegant-dark', 'clean-white', 'finance-terminal', 'tech-gradient', 'minimal-editorial', 'warm-paper', 'custom'] as const
export const DECK_THEME_DESCRIPTIONS: Record<string, string> = {
  'elegant-dark': '深色科技风，适合技术、AI、数据、编程主题',
  'clean-white': '简洁白净，适合商业汇报、教育、通用主题',
  'finance-terminal': '终端绿色风，适合金融、加密货币、数据终端主题',
  'tech-gradient': '蓝紫渐变，适合前沿科技、创新、未来感主题',
  'minimal-editorial': '暖色纸张风，适合人文、编辑、出版、学术主题',
  'warm-paper': '暖橙纸张风，适合生活、文化、温暖、故事性主题',
}

export interface DeckPlanningSourceSection {
  level: number
  preview: string
  title: string
}

export interface DeckPlanningSourceStructure {
  majorHeadings: string[]
  sections: DeckPlanningSourceSection[]
}

export function estimateTextDeckSlideCount(text: string, durationTargetSeconds: number | undefined): number {
  if (durationTargetSeconds !== undefined) {
    return clampInteger(Math.round(durationTargetSeconds / 22), 4, 14)
  }

  return clampInteger(Math.ceil(text.length / 900), 4, 12)
}

export function estimateNarrationCharactersPerSlide(durationTargetSeconds: number | undefined, slideCount: number): number {
  if (durationTargetSeconds === undefined) {
    return 110
  }

  return clampInteger(Math.round(durationTargetSeconds / Math.max(1, slideCount) * 4.5), 60, 150)
}

export function createDeckPlanningSourceStructure(text: string): DeckPlanningSourceStructure {
  const sections: Array<DeckPlanningSourceSection & {body: string[]}> = []
  let current: (DeckPlanningSourceSection & {body: string[]}) | undefined

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(rawLine)

    if (heading !== null) {
      current = {
        body: [],
        level: heading[1]?.length ?? 1,
        preview: '',
        title: cleanGeneratedText(heading[2], ''),
      }

      if (current.title !== '') {
        sections.push(current)
      }

      continue
    }

    current?.body.push(rawLine)
  }

  const visibleSections = sections
    .filter((section) => section.title !== '')
    .slice(0, 20)
    .map(({body, level, title}) => ({
      level,
      preview: truncateForLLM(stripMarkdownControlText(body.join('\n')), 360),
      title,
    }))

  return {
    majorHeadings: visibleSections
      .filter((section) => section.level <= 2)
      .map((section) => section.title)
      .slice(0, 12),
    sections: visibleSections,
  }
}

export function estimateNarrationDuration(text: string): number {
  return Math.max(4, Math.ceil(text.length / 12))
}

export function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function chunk<T>(items: T[], size: number): T[][] {
  const safeSize = Math.max(1, size)
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize))
  }

  return chunks
}

export function truncateForLLM(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) {
    return text
  }

  return `${text.slice(0, maxCharacters)}\n\n[truncated ${text.length - maxCharacters} characters]`
}

export function cleanGeneratedText(value: string | undefined, fallback: string): string {
  const cleaned = stripMarkdownControlText(value ?? '')
    .replaceAll(/^第\s*\d+\s*页[：:]\s*/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()

  return cleaned === '' ? fallback : cleaned
}

export function stripMarkdownControlText(value: string): string {
  return value
    .replaceAll(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n?/u, '')
    .replaceAll(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replaceAll(/```/g, '')
    .split('\n')
    .map((line) => line
      .replace(/^#{1,6}\s+/u, '')
      .replace(/^[-*+]\s+/u, '')
      .replace(/^>\s*/u, '')
      .replace(/\|/g, ' ')
      .trim())
    .filter((line) => line !== '---')
    .join('\n')
    .trim()
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

export function normalizeDeckTheme(theme: string | undefined): Deck['theme'] {
  if (theme === undefined || theme === 'auto') {
    return DEFAULT_DECK_THEME
  }

  if (DECK_THEMES.includes(theme as Deck['theme'])) {
    return theme as Deck['theme']
  }

  throw new Error(`Unsupported deck theme "${theme}". Expected one of: ${DECK_THEMES.join(', ')}.`)
}

export function resolveTheme(llmTheme: string | undefined, optionTheme: string | undefined): Deck['theme'] {
  if (optionTheme !== undefined && optionTheme !== 'auto') {
    return normalizeDeckTheme(optionTheme)
  }

  if (llmTheme !== undefined && DECK_THEMES.includes(llmTheme as Deck['theme'])) {
    return llmTheme as Deck['theme']
  }

  return DEFAULT_DECK_THEME
}

export function defaultSlideMotion(index: number, type: DeckSlideType | undefined): Slide['motion'] {
  if (index === 0 || type === 'hero') {
    return 'cinematic-rise'
  }

  if (type === 'comparison') {
    return 'card-stack'
  }

  if (type === 'timeline' || type === 'process') {
    return 'progressive-reveal'
  }

  if (type === 'stat') {
    return 'number-count'
  }

  return 'progressive-reveal'
}

export function visualKindForSlideType(type: DeckSlideType): DeckVisual['kind'] {
  if (type === 'hero') {
    return 'title-card'
  }

  if (type === 'chart' || type === 'stat') {
    return 'chart'
  }

  if (type === 'code') {
    return 'code'
  }

  if (type === 'process' || type === 'timeline') {
    return 'process'
  }

  return 'text'
}

export function createTimedDeck(deck: Deck, timings: SlideTiming[]): TimedDeck {
  return {
    deck,
    timings,
    version: 1,
  }
}
