import {DEFAULT_DECK_CONTENT_DENSITY, DEFAULT_DECK_FORMAT} from '@video-agent/ir'
import {deckTemplateManifestForLLM} from '@video-agent/renderer-deck'

import {LLM_TEXT_DECK_MAX_SLIDES} from './llm-plan.js'
import type {TextDeckProjectPlanOptions} from './types.js'
import {DECK_THEME_DESCRIPTIONS} from './utils.js'

const DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS = 60_000
const DECK_LLM_TRANSCRIPT_SEGMENT_CHUNK_SIZE = 500
const DECK_LLM_TRANSCRIPT_SEGMENT_TEXT_MAX_CHARACTERS = 500

export interface DeckPlanningSourceChunk {
  chunkId: string
  text: string
  transcriptSegments?: Array<{
    end: number
    index: number
    speaker?: string
    start: number
    text: string
  }>
}

interface DeckContentDensityTarget {
  level: NonNullable<TextDeckProjectPlanOptions['contentDensity']>
  narrationPolicy: string
  slideCountPolicy: string
  visibleTextPolicy: string
}

interface DeckSlideCountIntent {
  maximum: number
  minimum: number
  policy: string
  target?: number
}

interface DeckPlanningIntent {
  contentDensity: DeckContentDensityTarget
  durationSeconds?: number
  format: NonNullable<TextDeckProjectPlanOptions['deckFormat']>
  language: string
  maxSlideCharacters: number
  maxVisibleCharactersPerSlide: number
  requestedTheme?: string
  requestedTitle?: string
  requiredSlideTypes?: TextDeckProjectPlanOptions['requiredSlideTypes']
  slideCount: DeckSlideCountIntent
}

export function createDeckPlanningSourceChunks(text: string, options: TextDeckProjectPlanOptions): DeckPlanningSourceChunk[] {
  if (options.transcriptSegments !== undefined && options.transcriptSegments.length > DECK_LLM_TRANSCRIPT_SEGMENT_CHUNK_SIZE) {
    const summarizedSegments = summarizeTranscriptSegments(options.transcriptSegments)
    const chunks: DeckPlanningSourceChunk[] = []

    for (let index = 0; index < summarizedSegments.length; index += DECK_LLM_TRANSCRIPT_SEGMENT_CHUNK_SIZE) {
      const transcriptSegments = summarizedSegments.slice(index, index + DECK_LLM_TRANSCRIPT_SEGMENT_CHUNK_SIZE)
      chunks.push({
        chunkId: `transcript-${String(chunks.length + 1).padStart(3, '0')}`,
        text: transcriptSegments.map((segment) => segment.text).join('\n'),
        transcriptSegments,
      })
    }

    return chunks
  }

  const transcriptSegments = options.transcriptSegments === undefined ? undefined : summarizeTranscriptSegments(options.transcriptSegments)

  if (text.length <= DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS) {
    return [{
      chunkId: 'text-001',
      text,
      ...(transcriptSegments === undefined ? {} : {transcriptSegments}),
    }]
  }

  return splitSourceTextIntoChunks(text).map((chunkText, index) => ({
    chunkId: `text-${String(index + 1).padStart(3, '0')}`,
    text: chunkText,
    ...(transcriptSegments === undefined ? {} : {transcriptSegments}),
  }))
}

export function requireDeckPlanningSourceType(sourceType: TextDeckProjectPlanOptions['sourceType']): NonNullable<TextDeckProjectPlanOptions['sourceType']> {
  if (sourceType === undefined) {
    throw new Error('Deck LLM planning requires an explicit sourceType before request construction; no request-time sourceType fallback is allowed.')
  }

  return sourceType
}

export function createDeckPlanningIntent(options: TextDeckProjectPlanOptions): DeckPlanningIntent {
  return {
    contentDensity: createDeckContentDensityTarget(options),
    format: options.deckFormat ?? DEFAULT_DECK_FORMAT,
    language: options.language,
    maxSlideCharacters: options.maxSlideCharacters,
    maxVisibleCharactersPerSlide: options.maxSlideCharacters,
    ...(options.durationTargetSeconds === undefined ? {} : {durationSeconds: options.durationTargetSeconds}),
    ...(options.theme === undefined || options.theme === 'auto' ? {} : {requestedTheme: options.theme}),
    ...(options.title === undefined ? {} : {requestedTitle: options.title}),
    ...(options.requiredSlideTypes === undefined ? {} : {requiredSlideTypes: options.requiredSlideTypes}),
    slideCount: createDeckSlideCountIntent(options),
  }
}

export function createDeckPlanningTarget(options: TextDeckProjectPlanOptions, settings: {includeTemplateManifest: boolean}): object {
  const intent = createDeckPlanningIntent(options)

  return {
    availableThemes: Object.entries(DECK_THEME_DESCRIPTIONS).map(([name, description]) => ({description, name})),
    contentDensity: intent.contentDensity,
    durationSeconds: intent.durationSeconds,
    format: intent.format,
    language: intent.language,
    maxSlideCharacters: intent.maxSlideCharacters,
    maxVisibleCharactersPerSlide: intent.maxVisibleCharactersPerSlide,
    requestedTheme: intent.requestedTheme,
    requestedTitle: intent.requestedTitle,
    requiresOutline: true,
    requiresSlideTransitions: true,
    requiresSlideSourceRanges: true,
    requiredSlideTypes: intent.requiredSlideTypes,
    slideCount: intent.slideCount,
    speakerNotePlanning: {
      budgetSource: 'slideOutline.slides[].narrationBudgetSeconds as pacing guidance',
      englishWordsPerSecond: 2.6,
      policy: 'Plan narration against the whole deck duration. Use slide-level budgets as pacing guidance, not hard caps; rebalance detail and duration across slides.',
      zhCharactersPerSecond: 4.8,
    },
    targetPlatforms: ['douyin', 'kuaishou', 'bilibili', 'youtube', 'xhs', 'generic'],
    ...(settings.includeTemplateManifest ? {templateManifest: deckTemplateManifestForLLM} : {}),
  }
}

function splitSourceTextIntoChunks(text: string): string[] {
  const chunks: string[] = []
  const paragraphs = text.split(/(?<=\n)\n+/u)
  let current = ''

  for (const paragraph of paragraphs) {
    if (paragraph.length > DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS) {
      if (current !== '') {
        chunks.push(current)
        current = ''
      }

      for (let index = 0; index < paragraph.length; index += DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS) {
        chunks.push(paragraph.slice(index, index + DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS))
      }

      continue
    }

    if (current.length > 0 && current.length + paragraph.length > DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS) {
      chunks.push(current)
      current = paragraph
      continue
    }

    current += paragraph
  }

  if (current !== '') {
    chunks.push(current)
  }

  if (chunks.length === 0) {
    throw new Error('Deck LLM planning source text is empty.')
  }

  return chunks
}

function createDeckContentDensityTarget(options: TextDeckProjectPlanOptions): DeckContentDensityTarget {
  const level = options.contentDensity ?? DEFAULT_DECK_CONTENT_DENSITY

  if (level === 'concise') {
    return {
      level,
      narrationPolicy: 'Use short presenter notes that explain only the visible point and the minimum transition context required for comprehension.',
      slideCountPolicy: 'Prefer fewer slides when source coverage remains faithful. Combine closely related details instead of expanding every example.',
      visibleTextPolicy: 'Use compact titles and one to two short visible points when possible. Omit secondary examples unless they are required for source fidelity.',
    }
  }

  if (level === 'detailed') {
    return {
      level,
      narrationPolicy: 'Use the available narration budget to explain concrete steps, caveats, examples, evidence, and why each visible point matters. Do not add unsupported material.',
      slideCountPolicy: 'Prefer splitting dense source material into more coherent slides instead of over-compressing required steps, examples, caveats, or evidence.',
      visibleTextPolicy: 'Include enough visible detail for the slide to be useful without narration: concrete nouns, key steps, caveats, and evidence labels, while staying within template limits.',
    }
  }

  return {
    level,
    narrationPolicy: 'Use natural presenter notes with enough context to connect the slide points, without expanding beyond the slide goal or narration budget.',
    slideCountPolicy: 'Balance slide count against source coverage. Split unrelated or dense required material, but keep closely related ideas together.',
    visibleTextPolicy: 'Use clear PPT-style visible text with two to three useful points when the template supports them, while preserving white space and source fidelity.',
  }
}

function createDeckSlideCountIntent(options: TextDeckProjectPlanOptions): DeckSlideCountIntent {
  const minimum = Math.max(1, options.requiredSlideTypes?.length ?? 1)
  const maximum = options.slideCountMax ?? LLM_TEXT_DECK_MAX_SLIDES
  const target = options.slideCountTarget

  if (!Number.isInteger(maximum) || maximum < minimum || maximum > LLM_TEXT_DECK_MAX_SLIDES) {
    throw new Error(`Deck max slide count must be an integer between ${minimum} and ${LLM_TEXT_DECK_MAX_SLIDES}; received ${maximum}.`)
  }

  if (target !== undefined && (!Number.isInteger(target) || target < minimum || target > maximum)) {
    throw new Error(`Deck target slide count must be an integer between ${minimum} and ${maximum}; received ${target}.`)
  }

  return {
    maximum,
    minimum,
    policy: target === undefined
      ? 'Choose slide count from source complexity, required coverage, content density, duration, and template capacity within this range.'
      : 'Use the exact target slide count. Preserve source coverage by choosing tighter slide goals before violating the target.',
    ...(target === undefined ? {} : {target}),
  }
}

function summarizeTranscriptSegments(segments: NonNullable<TextDeckProjectPlanOptions['transcriptSegments']>): NonNullable<DeckPlanningSourceChunk['transcriptSegments']> {
  return segments.map((segment, index) => {
    const text = segment.text

    if (text.trim() === '') {
      throw new Error(`Deck LLM planning transcript segment ${index + 1} is empty; no silent segment filtering is allowed.`)
    }

    if (text !== text.trim()) {
      throw new Error(`Deck LLM planning transcript segment ${index + 1} contains leading or trailing whitespace; no runtime transcript segment trim is allowed.`)
    }

    if (text.length > DECK_LLM_TRANSCRIPT_SEGMENT_TEXT_MAX_CHARACTERS) {
      throw new Error(`Deck LLM planning transcript segment ${index + 1} has ${text.length} characters, exceeding the single-request segment limit ${DECK_LLM_TRANSCRIPT_SEGMENT_TEXT_MAX_CHARACTERS}; no silent segment truncation is allowed.`)
    }

    return {
      end: segment.end,
      index,
      ...(segment.speaker === undefined ? {} : {speaker: segment.speaker}),
      start: segment.start,
      text,
    }
  })
}
