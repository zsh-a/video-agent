import type {Claim, Claims, ContentBlock, Deck, DeckSourceMap, Document, DocumentSourceType, LongVideoSelectedMoments, MediaInfo, Narration, Outline, Slide, SlideTiming, SourceQuote, SourceQuotes, SpeakerScript, Storyboard, Timeline} from '@video-agent/ir'

import {ClaimsSchema, ContentBlocksSchema, DEFAULT_DECK_FORMAT, DeckBriefSchema, DeckCoherenceReportSchema, DeckContentAnalysisSchema, DeckSchema, DeckSlideOutlineSchema, DocumentSchema, NarrationSchema, OutlineSchema, SourceQuotesSchema, SpeakerScriptSchema, StoryboardSchema, TimedDeckSchema, TimelineSchema} from '@video-agent/ir'
import {countQualityIssues} from '@video-agent/quality'
import {CONTENT_ANALYSIS_ARTIFACT_NAME, DECK_BRIEF_ARTIFACT_NAME, DECK_COHERENCE_REPORT_ARTIFACT_NAME, SLIDE_OUTLINE_ARTIFACT_NAME} from '@video-agent/runtime'

import {normalizeLLMTextDeckSlides, type LLMTextDeckPlan, type NormalizedLLMTextDeckSlide} from './llm-plan.js'
import {deckSlideText} from './slide-content.js'
import type {TextDeckProjectPlan, TextDeckProjectPlanOptions} from './types.js'
import {assertNoGeneratedTextControlSyntax, cleanGeneratedText, createTextMediaInfo, createTimedDeck, resolveTheme} from './utils.js'
import {createTextQualityIssues} from '../quality/report.js'
import {createDeckNarrationFromTimings, createDeckStoryboard, createSlideTimingsFromSpeakerScript, createTextTimeline} from './timing.js'
import {createDeckCoverageReport, assertDeckCoverage} from '../quality/coverage.js'
import {assertDeckScriptTiming, createDeckScriptTimingReport} from '../quality/script-timing.js'
import {roundSeconds} from '../shared/utils.js'

export function createTextDeckProjectPlanFromLLM(inputPath: string, sourceText: string, rawPlan: LLMTextDeckPlan, options: TextDeckProjectPlanOptions): TextDeckProjectPlan {
  const planTitle = options.title ?? requireLLMPlanText(rawPlan.title, 'title')
  const planSummary = requireLLMPlanText(rawPlan.summary, 'summary')
  const planLanguage = requireLLMPlanText(rawPlan.language, 'language')
  const slides = normalizeSlideDurations(normalizeLLMTextDeckSlides(rawPlan), options.durationTargetSeconds)
  const sourceType = requireDeckSourceType(options.sourceType)
  const sourceMap = requireDeckSourceMap(options.sourceMap)
  const contentAnalysis = DeckContentAnalysisSchema.parse(requireStagedArtifact(options.contentAnalysis, CONTENT_ANALYSIS_ARTIFACT_NAME))
  const deckBrief = DeckBriefSchema.parse(requireStagedArtifact(options.deckBrief, DECK_BRIEF_ARTIFACT_NAME))
  const slideOutline = DeckSlideOutlineSchema.parse(requireStagedArtifact(options.slideOutline, SLIDE_OUTLINE_ARTIFACT_NAME))
  const coherenceReport = DeckCoherenceReportSchema.parse(requireStagedArtifact(options.coherenceReport, DECK_COHERENCE_REPORT_ARTIFACT_NAME))
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
      ...(slide.process === undefined ? {} : {process: slide.process}),
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
    format: options.deckFormat ?? DEFAULT_DECK_FORMAT,
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
    coherenceReport,
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

function normalizeSlideDurations(slides: NormalizedLLMTextDeckSlide[], durationTargetSeconds: number | undefined): NormalizedLLMTextDeckSlide[] {
  if (durationTargetSeconds === undefined) {
    return slides
  }

  const totalDuration = slides.reduce((sum, slide) => sum + slide.duration, 0)

  if (totalDuration <= 0) {
    throw new Error('Deck LLM slide durations must contain a positive total before target normalization.')
  }

  const scale = durationTargetSeconds / totalDuration
  let cursor = 0

  return slides.map((slide, index) => {
    const isLastSlide = index === slides.length - 1
    const duration = isLastSlide
      ? roundSeconds(durationTargetSeconds - cursor)
      : roundSeconds(slide.duration * scale)

    if (duration <= 0) {
      throw new Error(`Deck LLM slide ${index + 1} normalized duration must stay positive.`)
    }

    cursor = roundSeconds(cursor + duration)

    return {
      ...slide,
      duration,
    }
  })
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

function requireDeckSourceMap(sourceMap: DeckSourceMap | undefined): DeckSourceMap {
  if (sourceMap === undefined) {
    throw new Error('Deck artifact build requires source-map.json from the source-map stage; no semantic source map fallback is allowed.')
  }

  return sourceMap
}

function requireStagedArtifact<T>(artifact: T | undefined, artifactName: string): T {
  if (artifact === undefined) {
    throw new Error(`Deck artifact build requires ${artifactName} from staged LLM generation; no raw-plan semantic fallback is allowed.`)
  }

  return artifact
}

function createLLMTextDocument(
  inputPath: string,
  deck: Deck,
  slides: NormalizedLLMTextDeckSlide[],
  speakerScript: SpeakerScript,
  language: string,
  title: string,
  summary: string,
  sourceType: DocumentSourceType,
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

function requireDeckSourceType(sourceType: DocumentSourceType | undefined): DocumentSourceType {
  if (sourceType === undefined) {
    throw new Error('Deck plan artifact generation requires an explicit sourceType; no artifact-time sourceType fallback is allowed.')
  }

  return sourceType
}

function createLLMSlideEvidence(
  sourceType: DocumentSourceType,
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
    summary: countQualityIssues(issues),
    ttsSegments: 0,
    version: 1,
  }
}
