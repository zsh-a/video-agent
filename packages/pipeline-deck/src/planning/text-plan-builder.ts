import type {Claim, Claims, ContentBlock, Deck, DeckBrief, DeckContentAnalysis, DeckSlideOutline, DeckSourceMap, Document, LongVideoSelectedMoments, MediaInfo, Narration, Outline, Slide, SlideTiming, SourceQuote, SourceQuotes, SpeakerScript, Storyboard, Timeline} from '@video-agent/ir'

import {ClaimsSchema, ContentBlocksSchema, DeckBriefSchema, DeckContentAnalysisSchema, DeckSchema, DeckSlideOutlineSchema, DocumentSchema, NarrationSchema, OutlineSchema, SourceQuotesSchema, SpeakerScriptSchema, StoryboardSchema, TimedDeckSchema, TimelineSchema} from '@video-agent/ir'

import {normalizeLLMTextDeckSlides, type LLMTextDeckPlan, type NormalizedLLMTextDeckSlide} from './llm-plan.js'
import {deckSlideText} from './slide-content.js'
import type {TextDeckProjectPlan, TextDeckProjectPlanOptions} from './types.js'
import {assertNoGeneratedTextControlSyntax, cleanGeneratedText, createTextMediaInfo, createTimedDeck, resolveTheme} from './utils.js'
import {createTextQualityIssues, summarizeQualityIssues} from '../quality/report.js'
import {createDeckNarrationFromTimings, createDeckStoryboard, createSlideTimingsFromSpeakerScript, createTextTimeline} from './timing.js'
import {createDeckCoverageReport, assertDeckCoverage} from '../quality/coverage.js'
import {assertDeckScriptTiming, createDeckScriptTimingReport} from '../quality/script-timing.js'
import {createDeckSourceMap} from './source-map.js'

export function createTextDeckProjectPlanFromLLM(inputPath: string, sourceText: string, rawPlan: LLMTextDeckPlan, options: TextDeckProjectPlanOptions): TextDeckProjectPlan {
  const planTitle = options.title ?? requireLLMPlanText(rawPlan.title, 'title')
  const planSummary = requireLLMPlanText(rawPlan.summary, 'summary')
  const planLanguage = requireLLMPlanText(rawPlan.language, 'language')
  const slides = normalizeLLMTextDeckSlides(rawPlan)
  const sourceType = requireDeckSourceType(options.sourceType)
  const sourceMap = options.sourceMap ?? createDeckSourceMap({
    inputPath,
    language: planLanguage,
    sourceType,
    text: sourceText,
    title: planTitle,
  })
  const contentAnalysis = normalizeContentAnalysis(options.contentAnalysis, rawPlan, sourceMap)
  const deckBrief = normalizeDeckBrief(options.deckBrief, rawPlan, contentAnalysis, options.durationTargetSeconds)
  const slideOutline = normalizeSlideOutline(options.slideOutline, rawPlan, deckBrief)
  const preDeckCoverageReport = createDeckCoverageReport({
    analysis: contentAnalysis,
    brief: deckBrief,
    slideOutline,
  })

  assertDeckCoverage(preDeckCoverageReport)
  assertSourceRangesWithinDuration(slides, options)
  const deckSlides = slides.map((slide, index): Slide => {
    const slideId = `slide-${String(index + 1).padStart(3, '0')}`
    const blockId = `block-${String(index + 1).padStart(3, '0')}`

    return {
      blockIds: [blockId],
      ...(slide.chart === undefined ? {} : {chart: slide.chart}),
      ...(slide.code === undefined ? {} : {code: slide.code}),
      ...(slide.comparison === undefined ? {} : {comparison: slide.comparison}),
      duration: slide.duration,
      evidence: createLLMSlideEvidence(sourceType, slideId, slide),
      motion: slide.motion,
      points: slide.points,
      ...(slide.quote === undefined ? {} : {quote: slide.quote}),
      slideId,
      speakerNote: slide.speakerNote,
      ...(slide.stat === undefined ? {} : {stat: slide.stat}),
      ...(slide.subtitle === undefined ? {} : {subtitle: slide.subtitle}),
      title: slide.title,
      ...(slide.transitionOut === undefined ? {} : {transitionOut: slide.transitionOut}),
      type: slide.type,
      visual: slide.visual,
    }
  })
  const resolvedTheme = resolveTheme(rawPlan.theme, options.theme)
  const deck = DeckSchema.parse({
    format: options.deckFormat ?? 'portrait_1080x1920',
    inputMode: 'script-generated',
    language: planLanguage,
    slides: deckSlides,
    theme: resolvedTheme,
    title: planTitle,
    version: 1,
  })
  assertDeckVisibleTextWithinLimit(deck, options.maxSlideCharacters)
  const speakerScript = SpeakerScriptSchema.parse({
    language: planLanguage,
    mode: 'script-generated',
    segments: slides.map((slide, index) => ({
      estimatedDuration: slide.duration,
      slideId: requireDeckSlide(deck, index).slideId,
      text: slide.speakerNote,
    })),
    version: 1,
  })
  const scriptTimingReport = createDeckScriptTimingReport(speakerScript)

  const timings = createSlideTimingsFromSpeakerScript(speakerScript, options.durationTargetSeconds)
  const timedDeck = TimedDeckSchema.parse(createTimedDeck(deck, timings))
  const duration = requireLastTimingEnd(timings)
  const mediaInfo = createTextMediaInfo(inputPath, duration)
  const document = DocumentSchema.parse(createLLMTextDocument(inputPath, deck, slides, speakerScript, planLanguage, planTitle, planSummary, sourceType))
  const contentBlocks = ContentBlocksSchema.parse({
    blocks: document.blocks,
    version: 1,
  })
  const claims = ClaimsSchema.parse(createClaimsFromLLMSlides(slides, document))
  const sourceQuotes = SourceQuotesSchema.parse(createSourceQuotesFromLLMSlides(slides, document))
  const outline = OutlineSchema.parse(createDeckOutlineFromLLM(rawPlan.outline, deck, planLanguage, planTitle, options.durationTargetSeconds))
  const selectedMoments = createDeckSelectedMoments(inputPath, deck, timings, slides)
  const storyboard = StoryboardSchema.parse(createDeckStoryboard(deck, timings, planLanguage, rawPlan.targetPlatform, slides))
  const timeline = TimelineSchema.parse(createTextTimeline(duration))
  const narration = NarrationSchema.parse(createDeckNarrationFromTimings(speakerScript, timings))
  const coverageReport = createDeckCoverageReport({
    analysis: contentAnalysis,
    brief: deckBrief,
    deck,
    slideOutline,
  })
  const qualityReport = createTextPlanQualityReport({
    mediaInfo,
    narration,
    selectedMoments,
    storyboard,
    timeline,
  })

  assertDeckScriptTiming(scriptTimingReport)

  return {
    claims,
    contentBlocks,
    contentAnalysis,
    coverageReport,
    deck,
    deckBrief,
    document,
    mediaInfo,
    narration,
    outline,
    qualityReport,
    selectedMoments,
    sourceQuotes,
    speakerScript,
    scriptTimingReport,
    slideOutline,
    sourceMap,
    storyboard,
    timedDeck,
    timeline,
  }
}

function assertDeckVisibleTextWithinLimit(deck: Deck, limit: number): void {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`Deck planning maxSlideCharacters must be a positive number; received ${limit}.`)
  }

  for (const slide of deck.slides) {
    const visibleCharacters = deckSlideText(slide).length

    if (visibleCharacters > limit) {
      throw new Error(`LLM Deck plan slide "${slide.title}" has ${visibleCharacters} visible characters, exceeding target maxSlideCharacters ${limit}. Rewrite or split the slide in LLM output.`)
    }
  }
}

function normalizeContentAnalysis(
  contentAnalysis: DeckContentAnalysis | undefined,
  rawPlan: LLMTextDeckPlan,
  sourceMap: DeckSourceMap,
): DeckContentAnalysis {
  if (contentAnalysis !== undefined) {
    return DeckContentAnalysisSchema.parse(contentAnalysis)
  }

  return DeckContentAnalysisSchema.parse({
    audience: rawPlan.audience,
    generatedAt: new Date().toISOString(),
    language: rawPlan.language,
    sections: rawPlan.slides.map((slide, index) => {
      const sourceSection = sourceMap.sections[index] ?? sourceMap.sections.at(-1)
      const sectionId = sourceSection?.id ?? `source-section-${String(index + 1).padStart(3, '0')}`

      return {
        id: sectionId,
        importance: slide.semantic.momentScore,
        keyClaims: [
          slide.semantic.claim === null
            ? {
                confidence: 0.7,
                sourceQuoteText: slide.semantic.sourceQuoteText,
                text: slide.semantic.blockText,
                type: 'summary' as const,
              }
            : {
                confidence: slide.semantic.claim.confidence,
                sourceQuoteText: slide.semantic.sourceQuoteText,
                text: slide.semantic.claim.text,
                type: slide.semantic.claim.type,
              },
        ],
        mustCover: true,
        role: slide.semantic.blockType,
        sourceRange: sourceSection?.sourceRange ?? slide.sourceRange,
        summary: slide.semantic.blockText,
        title: slide.title,
        visualRole: slide.semantic.visualStyle,
      }
    }),
    source: 'source-map.json',
    summary: rawPlan.summary,
    title: rawPlan.title,
    version: 1,
  })
}

function normalizeDeckBrief(
  deckBrief: DeckBrief | undefined,
  rawPlan: LLMTextDeckPlan,
  contentAnalysis: DeckContentAnalysis,
  durationTargetSeconds: number | undefined,
): DeckBrief {
  if (deckBrief !== undefined) {
    return DeckBriefSchema.parse(deckBrief)
  }

  const requiredSectionIds = contentAnalysis.sections.filter((section) => section.mustCover).map((section) => section.id)

  return DeckBriefSchema.parse({
    audience: rawPlan.audience,
    densityPolicy: 'Use one slide per coherent source-backed idea and keep narration within the authored duration budget.',
    generatedAt: new Date().toISOString(),
    language: rawPlan.language,
    narrativeArc: rawPlan.outline.sections.map((section) => section.goal),
    objective: rawPlan.summary,
    optionalSectionIds: contentAnalysis.sections.filter((section) => !section.mustCover).map((section) => section.id),
    requiredSectionIds,
    source: 'content-analysis.json',
    styleIntent: 'Source-grounded explainer deck.',
    ...(durationTargetSeconds === undefined ? {} : {targetDurationSeconds: durationTargetSeconds}),
    targetSlideCount: rawPlan.slides.length,
    title: rawPlan.title,
    version: 1,
  })
}

function normalizeSlideOutline(
  slideOutline: DeckSlideOutline | undefined,
  rawPlan: LLMTextDeckPlan,
  deckBrief: DeckBrief,
): DeckSlideOutline {
  if (slideOutline !== undefined) {
    return DeckSlideOutlineSchema.parse(slideOutline)
  }

  const fallbackRequired = deckBrief.requiredSectionIds.length === 0 ? ['source-section-001'] : deckBrief.requiredSectionIds

  return DeckSlideOutlineSchema.parse({
    generatedAt: new Date().toISOString(),
    slides: rawPlan.slides.map((slide, index) => ({
      goal: rawPlan.outline.sections[index]?.goal ?? slide.semantic.momentReason,
      informationRole: slide.semantic.blockType,
      mustCover: true,
      narrationBudgetSeconds: slide.duration,
      outlineId: `outline-${String(index + 1).padStart(3, '0')}`,
      sourceSectionIds: slide.sectionIds ?? [fallbackRequired[Math.min(index, fallbackRequired.length - 1)] ?? 'source-section-001'],
      templateIntent: slide.type,
      visualIntent: slide.semantic.visualStyle,
    })),
    source: 'deck-brief.json',
    version: 1,
  })
}

function createLLMTextDocument(
  inputPath: string,
  deck: Deck,
  slides: NormalizedLLMTextDeckSlide[],
  speakerScript: SpeakerScript,
  language: string,
  title: string,
  summary: string,
  sourceType: Document['source']['sourceType'],
): Document {
  return {
    blocks: deck.slides.map((slide, index): ContentBlock => {
      const semantic = requireSlideSemantic(slides, index)

      return {
        evidence: slide.evidence,
        id: `block-${String(index + 1).padStart(3, '0')}`,
        sourceRange: requireLLMSlide(slides, index).sourceRange,
        text: semantic.blockText,
        type: semantic.blockType,
      }
    }),
    source: {
      language,
      path: inputPath,
      sourceType,
      title,
    },
    text: [title, cleanGeneratedText(summary, 'summary'), ...speakerScript.segments.map((segment) => segment.text)].filter(Boolean).join('\n\n'),
    version: 1,
  }
}

function requireDeckSourceType(sourceType: Document['source']['sourceType'] | undefined): Document['source']['sourceType'] {
  if (sourceType === undefined) {
    throw new Error('Deck plan artifact generation requires an explicit sourceType; no artifact-time sourceType fallback is allowed.')
  }

  return sourceType
}

function createLLMSlideEvidence(
  sourceType: Document['source']['sourceType'],
  slideId: string,
  slide: NormalizedLLMTextDeckSlide,
): Slide['evidence'] {
  return [{
    ref: `${sourceType === 'audio' ? 'audio-transcript' : 'text-input'}#${slideId}`,
    text: slide.semantic.sourceQuoteText,
    type: sourceType === 'audio' ? 'asr' : 'research',
  }]
}

function createClaimsFromLLMSlides(slides: NormalizedLLMTextDeckSlide[], document: Document): Claims {
  const claims = slides.flatMap((slide, index): Claim[] => {
    const block = document.blocks[index]

    if (block === undefined) {
      throw new Error(`Deck claims expected content block ${index + 1} for LLM slide "${slide.title}".`)
    }

    if (slide.semantic.claim === null) {
      return []
    }

    return [{
      blockId: block.id,
      confidence: slide.semantic.claim.confidence,
      evidence: block.evidence,
      id: `claim-${String(index + 1).padStart(3, '0')}`,
      text: slide.semantic.claim.text,
      type: slide.semantic.claim.type,
    }]
  })

  return {
    claims,
    version: 1,
  }
}

function createSourceQuotesFromLLMSlides(slides: NormalizedLLMTextDeckSlide[], document: Document): SourceQuotes {
  return {
    quotes: slides.map((slide, index): SourceQuote => {
      const block = requireDocumentBlock(document, index)

      return {
        blockId: block.id,
        evidence: block.evidence,
        id: `quote-${String(index + 1).padStart(3, '0')}`,
        sourceRange: slide.sourceRange,
        text: slide.semantic.sourceQuoteText,
      }
    }),
    version: 1,
  }
}

function createDeckOutlineFromLLM(outline: LLMTextDeckPlan['outline'], deck: Deck, language: string, title: string, durationTarget: number | undefined): Outline {
  if (outline === undefined) {
    throw new Error('LLM Deck plan is missing outline. Rewrite the outline in LLM output; no slide-title or speaker-note outline fallback is allowed.')
  }

  if (outline.sections.length !== deck.slides.length) {
    throw new Error(`LLM Deck plan outline must include exactly one section per slide; got ${outline.sections.length} section(s) for ${deck.slides.length} slide(s). Rewrite the outline in LLM output.`)
  }

  return {
    ...(outline.audience === undefined ? {} : {audience: cleanOptionalLLMPlanText(outline.audience, 'outline.audience')}),
    durationTarget,
    language,
    sections: outline.sections.map((section, index) => {
      const slide = requireDeckSlide(deck, index)

      return {
        blockIds: slide.blockIds,
        duration: slide.duration,
        goal: requireLLMPlanText(section.goal, `outline.sections[${index}].goal`),
        id: `section-${String(index + 1).padStart(3, '0')}`,
        title: requireLLMPlanText(section.title, `outline.sections[${index}].title`),
      }
    }),
    title,
    version: 1,
  }
}

export function createDeckSelectedMoments(
  inputPath: string,
  deck: Deck,
  timings: SlideTiming[],
  slides: NormalizedLLMTextDeckSlide[],
  options: {
    chunkId?: string
    idPrefix?: string
  } = {},
): LongVideoSelectedMoments {
  const chunkId = options.chunkId ?? 'text-000'
  const idPrefix = options.idPrefix ?? 'text-slide'

	  return {
	    moments: deck.slides.map((slide, index) => {
	      requireSlideTiming(timings, index, slide.slideId)
	      const semantic = requireSlideSemantic(slides, index)
	      const llmSlide = requireLLMSlide(slides, index)

      return {
        chunkId,
        evidence: slide.evidence,
        id: `${idPrefix}-${String(index + 1).padStart(3, '0')}`,
        reason: semantic.momentReason,
        score: semantic.momentScore,
        sourceRange: llmSlide.sourceRange,
        summary: semantic.momentSummary,
        title: slide.title,
      }
    }),
    source: inputPath,
    version: 1,
  }
}

function assertSourceRangesWithinDuration(slides: NormalizedLLMTextDeckSlide[], options: TextDeckProjectPlanOptions): void {
  slides.forEach((slide, index) => {
    if (options.durationTargetSeconds !== undefined && slide.sourceRange[1] > options.durationTargetSeconds + 0.001) {
      throw new Error(`LLM Deck plan slide ${index + 1} sourceRange exceeds source audio duration.`)
    }
  })
}

function requireLLMSlide(slides: NormalizedLLMTextDeckSlide[], index: number): NormalizedLLMTextDeckSlide {
  const slide = slides[index]

  if (slide === undefined) {
    throw new Error(`LLM Deck plan is missing slide ${index + 1}.`)
  }

  return slide
}

function requireSlideSemantic(slides: NormalizedLLMTextDeckSlide[], index: number): NormalizedLLMTextDeckSlide['semantic'] {
  const semantic = slides[index]?.semantic

  if (semantic === undefined) {
    throw new Error(`LLM Deck plan slide ${index + 1} is missing semantic metadata.`)
  }

  return semantic
}

function requireDeckSlide(deck: Deck, index: number): Slide {
  const slide = deck.slides[index]

  if (slide === undefined) {
    throw new Error(`Deck planning expected slide ${index + 1}, but the deck has no matching slide.`)
  }

  return slide
}

function requireDocumentBlock(document: Document, index: number): ContentBlock {
  const block = document.blocks[index]

  if (block === undefined) {
    throw new Error(`Deck planning expected content block ${index + 1}, but the document has no matching block.`)
  }

  return block
}

function requireLastTimingEnd(timings: SlideTiming[]): number {
  const lastTiming = timings.at(-1)

  if (lastTiming === undefined) {
    throw new Error('Deck planning produced no slide timings.')
  }

  return lastTiming.end
}

function requireSlideTiming(timings: SlideTiming[], index: number, slideId: string): SlideTiming {
  const timing = timings[index]

  if (timing === undefined || timing.slideId !== slideId) {
    throw new Error(`Deck planning expected timing ${index + 1} for slide "${slideId}".`)
  }

  return timing
}

function requireLLMPlanText(value: string, field: string): string {
  assertNoGeneratedTextControlSyntax(value, field)

  const cleaned = cleanGeneratedText(value, field)

  if (cleaned === '') {
    throw new Error(`LLM Deck plan ${field} is empty.`)
  }

  return cleaned
}

function cleanOptionalLLMPlanText(value: string, field: string): string {
  assertNoGeneratedTextControlSyntax(value, field)

  const cleaned = cleanGeneratedText(value, field)

  if (cleaned === '') {
    throw new Error(`LLM Deck plan ${field} is empty.`)
  }

  return cleaned
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
