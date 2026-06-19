import type {ContentBlock, Deck, Document, LongVideoSelectedMoments, MediaInfo, Narration, Outline, Slide, SlideTiming, SpeakerScript, Storyboard, Timeline} from '@video-agent/ir'

import {ClaimsSchema, ContentBlocksSchema, DeckSchema, DocumentSchema, NarrationSchema, OutlineSchema, SourceQuotesSchema, SpeakerScriptSchema, StoryboardSchema, TimedDeckSchema, TimelineSchema} from '@video-agent/ir'

import {createClaimsFromDocument, createSourceQuotesFromDocument} from './deck-document-artifacts.js'
import {inferDocumentSourceType} from './deck-input.js'
import {normalizeLLMTextDeckSlides, type LLMTextDeckPlan} from './deck-llm-plan.js'
import type {TextDeckProjectPlan, TextDeckProjectPlanOptions} from './deck-plan-types.js'
import {cleanGeneratedText, createTextMediaInfo, createTimedDeck, defaultSlideMotion, estimateNarrationDuration, resolveTheme, stripMarkdownControlText, truncateForLLM, visualKindForSlideType} from './deck-planning-utils.js'
import {createTextQualityIssues, summarizeQualityIssues} from './deck-quality.js'
import {deckSlideContentParts} from './deck-slide-content.js'
import {createDeckNarrationFromTimings, createDeckStoryboard, createSlideTimingsFromSpeakerScript, createTextTimeline} from './deck-timing.js'

export function createTextDeckProjectPlanFromLLM(inputPath: string, sourceText: string, rawPlan: LLMTextDeckPlan, options: TextDeckProjectPlanOptions): TextDeckProjectPlan {
  const planTitle = options.title ?? cleanGeneratedText(rawPlan.title, 'Deck Explainer')
  const slides = normalizeLLMTextDeckSlides(rawPlan)
  const sourceEvidence = truncateForLLM(stripMarkdownControlText(sourceText), 4000)
  const deckSlides = slides.map((slide, index): Slide => {
    const slideId = `slide-${String(index + 1).padStart(3, '0')}`
    const blockId = `block-${String(index + 1).padStart(3, '0')}`

    return {
      blockIds: [blockId],
      ...(slide.code === undefined ? {} : {code: slide.code}),
      ...(slide.comparison === undefined ? {} : {comparison: slide.comparison}),
      duration: slide.duration,
      evidence: sourceEvidence === '' ? [] : [{ref: 'text-input', text: sourceEvidence, type: 'research'}],
      motion: slide.motion ?? defaultSlideMotion(index, slide.type),
      points: slide.points,
      ...(slide.quote === undefined ? {} : {quote: slide.quote}),
      slideId,
      speakerNote: slide.speakerNote,
      ...(slide.stat === undefined ? {} : {stat: slide.stat}),
      ...(slide.subtitle === undefined ? {} : {subtitle: slide.subtitle}),
      title: slide.title,
      type: slide.type ?? (index === 0 ? 'hero' : 'three-points'),
      visual: {
        assetRefs: [],
        kind: visualKindForSlideType(slide.type ?? (index === 0 ? 'hero' : 'three-points')),
      },
    }
  })
  const resolvedTheme = resolveTheme(rawPlan.theme, options.theme)
  const deck = DeckSchema.parse({
    format: options.deckFormat ?? 'portrait_1080x1920',
    inputMode: 'script-generated',
    language: options.language,
    slides: deckSlides,
    theme: resolvedTheme,
    title: planTitle,
    version: 1,
  })
  const speakerScript = SpeakerScriptSchema.parse({
    language: options.language,
    mode: 'script-generated',
    segments: slides.map((slide, index) => ({
      estimatedDuration: slide.duration ?? estimateNarrationDuration(slide.speakerNote),
      slideId: deck.slides[index]?.slideId ?? `slide-${String(index + 1).padStart(3, '0')}`,
      text: slide.speakerNote,
    })),
    version: 1,
  })
  const timings = createSlideTimingsFromSpeakerScript(speakerScript, options.durationTargetSeconds, options.slideSeconds)
  const timedDeck = TimedDeckSchema.parse(createTimedDeck(deck, timings))
  const duration = timings.at(-1)?.end ?? deck.slides.length * options.slideSeconds
  const mediaInfo = createTextMediaInfo(inputPath, duration)
  const document = DocumentSchema.parse(createLLMTextDocument(inputPath, sourceText, deck, speakerScript, options.language, planTitle, rawPlan.summary, options.sourceType))
  const contentBlocks = ContentBlocksSchema.parse({
    blocks: document.blocks,
    version: 1,
  })
  const claims = ClaimsSchema.parse(createClaimsFromDocument(document))
  const sourceQuotes = SourceQuotesSchema.parse(createSourceQuotesFromDocument(document))
  const outline = OutlineSchema.parse(createDeckOutlineFromSlides(deck, options.language, planTitle, options.durationTargetSeconds, rawPlan.audience))
  const selectedMoments = createDeckSelectedMoments(inputPath, deck, speakerScript, timings)
  const storyboard = StoryboardSchema.parse(createDeckStoryboard(deck, speakerScript, timings, options.language))
  const timeline = TimelineSchema.parse(createTextTimeline(duration))
  const narration = NarrationSchema.parse(createDeckNarrationFromTimings(speakerScript, timings))
  const qualityReport = createTextPlanQualityReport({
    mediaInfo,
    narration,
    selectedMoments,
    storyboard,
    timeline,
  })

  return {
    claims,
    contentBlocks,
    deck,
    document,
    mediaInfo,
    narration,
    outline,
    qualityReport,
    selectedMoments,
    sourceQuotes,
    speakerScript,
    storyboard,
    timedDeck,
    timeline,
  }
}

function createLLMTextDocument(
  inputPath: string,
  sourceText: string,
  deck: Deck,
  speakerScript: SpeakerScript,
  language: string,
  title: string,
  summary: string,
  sourceType: Document['source']['sourceType'] | undefined,
): Document {
  const sourceEvidence = truncateForLLM(stripMarkdownControlText(sourceText), 4000)

  return {
    blocks: deck.slides.map((slide, index): ContentBlock => {
      const script = speakerScript.segments[index]?.text
      const text = [slide.title, slide.subtitle, ...deckSlideContentParts(slide), script].filter((value): value is string => typeof value === 'string' && value.trim() !== '').join(' ')

      return {
        evidence: sourceEvidence === '' ? [] : [{ref: 'text-input', text: sourceEvidence, type: 'research'}],
        id: `block-${String(index + 1).padStart(3, '0')}`,
        text: text || slide.title,
        type: index === 0 ? 'summary' : contentBlockTypeForSlide(slide),
      }
    }),
    source: {
      language,
      path: inputPath,
      sourceType: sourceType ?? inferDocumentSourceType(inputPath),
      title,
    },
    text: [title, cleanGeneratedText(summary, ''), ...speakerScript.segments.map((segment) => segment.text)].filter(Boolean).join('\n\n'),
    version: 1,
  }
}

function contentBlockTypeForSlide(slide: Slide): ContentBlock['type'] {
  if (slide.type === 'quote') {
    return 'quote'
  }

  if (slide.type === 'cta') {
    return 'recommendation'
  }

  if (slide.type === 'summary') {
    return 'summary'
  }

  if (slide.type === 'chart' || slide.type === 'stat' || slide.type === 'timeline') {
    return 'data'
  }

  return 'claim'
}

function createDeckOutlineFromSlides(deck: Deck, language: string, title: string, durationTarget: number | undefined, audience: string | undefined): Outline {
  return {
    ...(audience === undefined ? {} : {audience: cleanGeneratedText(audience, '')}),
    durationTarget,
    language,
    sections: deck.slides.map((slide, index) => ({
      blockIds: slide.blockIds,
      duration: slide.duration,
      goal: slide.speakerNote ?? `Explain ${slide.title}.`,
      id: `section-${String(index + 1).padStart(3, '0')}`,
      title: slide.title,
    })),
    title,
    version: 1,
  }
}

export function createDeckSelectedMoments(
  inputPath: string,
  deck: Deck,
  speakerScript: SpeakerScript,
  timings: SlideTiming[],
  options: {
    chunkId?: string
    idPrefix?: string
    reason?: string
  } = {},
): LongVideoSelectedMoments {
  const chunkId = options.chunkId ?? 'text-000'
  const idPrefix = options.idPrefix ?? 'text-slide'
  const reason = options.reason ?? 'LLM-planned text section converted into a slide explainer page.'

  return {
    moments: deck.slides.map((slide, index) => {
      const timing = timings[index] ?? {end: index + 1, slideId: slide.slideId, start: index}
      const script = speakerScript.segments[index]

      return {
        chunkId,
        evidence: slide.evidence,
        id: `${idPrefix}-${String(index + 1).padStart(3, '0')}`,
        reason,
        score: 0.85,
        sourceRange: [timing.start, timing.end] as [number, number],
        summary: script?.text ?? slide.speakerNote ?? slide.title,
        title: slide.title,
      }
    }),
    source: inputPath,
    version: 1,
  }
}

export function createTextPlanQualityReport(input: {
  mediaInfo: MediaInfo
  narration: Narration
  selectedMoments: LongVideoSelectedMoments
  storyboard: Storyboard
  timeline: Timeline
}): TextDeckProjectPlan['qualityReport'] {
  const issues = createTextQualityIssues(input)

  return {
    checkedAt: new Date().toISOString(),
    issues,
    narrationSegments: input.narration.segments.length,
    summary: summarizeQualityIssues(issues),
    ttsSegments: 0,
    version: 1,
  }
}
