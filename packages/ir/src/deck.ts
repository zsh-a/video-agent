import {z} from 'zod'

import {QualityIssueSeveritySchema} from './quality.js'
import {EvidenceSchema} from './storyboard.js'

export const TIMED_DECK_ARTIFACT_NAME = 'timed-deck.json' as const

export const DECK_HTML_CAPTURE_BACKENDS = ['chromium', 'playwright'] as const

export const DeckHtmlCaptureBackendSchema = z.enum(DECK_HTML_CAPTURE_BACKENDS)

export type DeckHtmlCaptureBackend = (typeof DECK_HTML_CAPTURE_BACKENDS)[number]

export const DEFAULT_DECK_HTML_CAPTURE_BACKEND = 'playwright' satisfies DeckHtmlCaptureBackend

export const DECK_FORMATS = ['landscape_1920x1080', 'portrait_1080x1920', 'square_1080x1080'] as const

export const DEFAULT_DECK_FORMAT = 'portrait_1080x1920' satisfies (typeof DECK_FORMATS)[number]

export const DECK_INPUT_MODES = ['script-generated', 'audio-anchored'] as const

export const DECK_CONTENT_DENSITIES = ['concise', 'balanced', 'detailed'] as const

export const DEFAULT_DECK_CONTENT_DENSITY = 'balanced' satisfies (typeof DECK_CONTENT_DENSITIES)[number]

export const DEFAULT_DECK_LANGUAGE = 'auto' as const

export const DECK_PRESET_THEMES = [
  'elegant-dark',
  'clean-white',
  'finance-terminal',
  'tech-gradient',
  'minimal-editorial',
  'warm-paper',
] as const

export const DECK_THEMES = [
  'auto',
  ...DECK_PRESET_THEMES,
  'custom',
] as const

export const DECK_BASE_MOTION_PRESETS = [
  'fade-in',
  'slide-up',
  'soft-scale',
  'blur-rise',
  'stagger-up',
  'progressive-reveal',
  'card-stack',
  'line-draw',
  'number-count',
  'spotlight',
  'wipe',
  'zoom-focus',
  'cinematic-rise',
] as const

export const DECK_ADVANCED_MOTION_PRESETS = [
  'rotate',
  'spin',
  'spring',
  'bounce',
  'typewriter',
  'parallax',
] as const

export const DECK_MOTION_PRESETS = [...DECK_BASE_MOTION_PRESETS, ...DECK_ADVANCED_MOTION_PRESETS] as const

export const DECK_TRANSITION_TYPES = ['crossfade', 'fade', 'slide-left', 'slide-up', 'zoom-in', 'zoom-out', 'rotate'] as const

export const DECK_SLIDE_TYPES = [
  'hero',
  'section',
  'one-big-idea',
  'three-points',
  'comparison',
  'process',
  'timeline',
  'quote',
  'stat',
  'chart',
  'code',
  'summary',
  'cta',
  'image',
  'grid-cards',
] as const

export const DOCUMENT_SOURCE_TYPES = ['audio', 'html', 'markdown', 'pdf', 'text'] as const

export const TEXT_DOCUMENT_SOURCE_TYPES = ['html', 'markdown', 'pdf', 'text'] as const

export const CONTENT_BLOCK_TYPES = ['claim', 'context', 'data', 'example', 'quote', 'recommendation', 'summary'] as const

export const DECK_CLAIM_TYPES = ['claim', 'data', 'recommendation', 'summary'] as const

export const DECK_SOURCE_SECTION_KINDS = ['frontmatter', 'heading', 'paragraph', 'list', 'table', 'code'] as const

export const DECK_COHERENCE_REVIEW_SLIDE_OUTLINE_STAGE = 'slide-outline' as const
export const DECK_COHERENCE_REVIEW_SLIDE_PLAN_STAGE = 'slide-plan' as const
export const DECK_COHERENCE_REVIEW_SCRIPT_SEMANTICS_STAGE = 'script-semantics' as const
export const DECK_COHERENCE_REVIEW_STAGES = [
  DECK_COHERENCE_REVIEW_SLIDE_OUTLINE_STAGE,
  DECK_COHERENCE_REVIEW_SLIDE_PLAN_STAGE,
  DECK_COHERENCE_REVIEW_SCRIPT_SEMANTICS_STAGE,
] as const

export const DeckFormatSchema = z.enum(DECK_FORMATS)

export const DeckInputModeSchema = z.enum(DECK_INPUT_MODES)

export const DeckContentDensitySchema = z.enum(DECK_CONTENT_DENSITIES)

export const DeckThemeSchema = z.enum(DECK_THEMES)

export const DeckMotionPresetSchema = z.enum(DECK_MOTION_PRESETS)

export const DeckTransitionTypeSchema = z.enum(DECK_TRANSITION_TYPES)

export const DeckTransitionSchema = z.object({
  duration: z.number().finite().positive(),
  type: DeckTransitionTypeSchema,
})

export const DeckSlideTypeSchema = z.enum(DECK_SLIDE_TYPES)

export const DeckSourceRangeSchema = z.tuple([
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative(),
]).refine(([start, end]) => end > start, {
  message: 'Deck sourceRange end must be greater than start.',
})

export const DocumentSourceSchema = z.object({
  author: z.string().optional(),
  language: z.string().min(1),
  path: z.string().min(1).optional(),
  sourceType: z.enum(DOCUMENT_SOURCE_TYPES),
  title: z.string().optional(),
  url: z.string().url().optional(),
})

export const ContentBlockSchema = z.object({
  evidence: z.array(EvidenceSchema),
  id: z.string().min(1),
  sourceRange: DeckSourceRangeSchema,
  text: z.string().min(1),
  type: z.enum(CONTENT_BLOCK_TYPES),
})

export const DocumentSchema = z.object({
  blocks: z.array(ContentBlockSchema),
  source: DocumentSourceSchema,
  text: z.string().min(1),
  version: z.literal(1),
})

export const ContentBlocksSchema = z.object({
  blocks: z.array(ContentBlockSchema),
  version: z.literal(1),
})

export const DeckSourceSectionKindSchema = z.enum(DECK_SOURCE_SECTION_KINDS)

export const DeckSourceSectionSchema = z.object({
  headingPath: z.array(z.string().min(1)),
  id: z.string().min(1),
  kind: DeckSourceSectionKindSchema,
  sourceRange: DeckSourceRangeSchema,
  text: z.string().min(1),
})

export const DeckSourceMapSchema = z.object({
  generatedAt: z.string().min(1),
  language: z.string().min(1),
  sections: z.array(DeckSourceSectionSchema),
  source: DocumentSourceSchema,
  title: z.string().optional(),
  version: z.literal(1),
})

export const DeckContentAnalysisSchema = z.object({
  audience: z.string().min(1).optional(),
  generatedAt: z.string().min(1),
  language: z.string().min(1),
  sections: z.array(z.object({
    id: z.string().min(1),
    importance: z.number().min(0).max(1),
    keyClaims: z.array(z.object({
      confidence: z.number().min(0).max(1),
      sourceQuoteText: z.string().min(1),
      text: z.string().min(1),
      type: z.enum(DECK_CLAIM_TYPES),
    })).min(1),
    mustCover: z.boolean(),
    role: z.string().min(1),
    sourceRange: DeckSourceRangeSchema.optional(),
    summary: z.string().min(1),
    title: z.string().min(1),
    visualRole: z.string().min(1).optional(),
  })).min(1),
  source: z.literal('source-map.json'),
  summary: z.string().min(1),
  title: z.string().min(1),
  version: z.literal(1),
})

export const DeckBriefSchema = z.object({
  audience: z.string().min(1).optional(),
  densityPolicy: z.string().min(1),
  generatedAt: z.string().min(1),
  language: z.string().min(1),
  narrativeArc: z.array(z.string().min(1)).min(1),
  objective: z.string().min(1),
  optionalSectionIds: z.array(z.string().min(1)),
  requiredSectionIds: z.array(z.string().min(1)),
  source: z.literal('content-analysis.json'),
  styleIntent: z.string().min(1),
  targetDurationSeconds: z.number().finite().positive(),
  targetSlideCount: z.number().int().positive(),
  title: z.string().min(1),
  version: z.literal(1),
})

export const DeckSlideOutlineSchema = z.object({
  generatedAt: z.string().min(1),
  slides: z.array(z.object({
    goal: z.string().min(1),
    informationRole: z.string().min(1),
    mustCover: z.boolean(),
    narrationBudgetSeconds: z.number().finite().positive(),
    outlineId: z.string().min(1),
    sourceSectionIds: z.array(z.string().min(1)).min(1),
    templateIntent: DeckSlideTypeSchema,
    visualIntent: z.string().min(1),
  })).min(1),
  source: z.literal('deck-brief.json'),
  version: z.literal(1),
})

export const DeckCoverageReportSchema = z.object({
  checkedAt: z.string().min(1),
  coveredRequiredSections: z.number().int().nonnegative(),
  requiredSections: z.number().int().nonnegative(),
  requiredUncovered: z.array(z.string().min(1)),
  slideCoverage: z.array(z.object({
    outlineId: z.string().min(1),
    slideId: z.string().min(1).optional(),
    sourceSectionIds: z.array(z.string().min(1)),
  })),
  source: z.literal('slide-outline.json'),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
  version: z.literal(1),
})

export const DeckScriptTimingReportSchema = z.object({
  checkedAt: z.string().min(1),
  estimatedSpeechDuration: z.number().finite().nonnegative(),
  plannedDuration: z.number().finite().nonnegative(),
  segments: z.array(z.object({
    estimatedSpeechSeconds: z.number().finite().nonnegative(),
    issueCodes: z.array(z.string().min(1)),
    plannedSeconds: z.number().finite().positive(),
    slideId: z.string().min(1),
    textCharacters: z.number().int().nonnegative(),
    words: z.number().int().nonnegative(),
  })),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
  version: z.literal(1),
})

export const DeckCoherenceReportSchema = z.object({
  checkedAt: z.string().min(1),
  issues: z.array(z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    path: z.string().min(1).optional(),
    severity: QualityIssueSeveritySchema,
    slideId: z.string().min(1).optional(),
    stage: z.enum(DECK_COHERENCE_REVIEW_STAGES),
  })),
  reviewer: z.literal('llm'),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
  version: z.literal(1),
})

export const DeckTimingDriftReportSchema = z.object({
  checkedAt: z.string().min(1),
  plannedDuration: z.number().finite().nonnegative(),
  segments: z.array(z.object({
    driftRatio: z.number().finite().nonnegative(),
    issueCodes: z.array(z.string().min(1)),
    plannedSeconds: z.number().finite().positive(),
    slideId: z.string().min(1),
    ttsSeconds: z.number().finite().positive(),
  })),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
  totalDuration: z.number().finite().nonnegative(),
  version: z.literal(1),
})

export const ClaimSchema = z.object({
  blockId: z.string().min(1),
  confidence: z.number().finite().min(0).max(1),
  evidence: z.array(EvidenceSchema),
  id: z.string().min(1),
  text: z.string().min(1),
  type: z.enum(DECK_CLAIM_TYPES),
})

export const ClaimsSchema = z.object({
  claims: z.array(ClaimSchema),
  version: z.literal(1),
})

export const SourceQuoteSchema = z.object({
  blockId: z.string().min(1),
  evidence: z.array(EvidenceSchema),
  id: z.string().min(1),
  sourceRange: DeckSourceRangeSchema,
  text: z.string().min(1),
})

export const SourceQuotesSchema = z.object({
  quotes: z.array(SourceQuoteSchema),
  version: z.literal(1),
})

export const OutlineSectionSchema = z.object({
  blockIds: z.array(z.string().min(1)),
  duration: z.number().finite().positive().optional(),
  goal: z.string().min(1),
  id: z.string().min(1),
  title: z.string().min(1),
})

export const OutlineSchema = z.object({
  audience: z.string().optional(),
  durationTarget: z.number().finite().positive().optional(),
  language: z.string().min(1),
  sections: z.array(OutlineSectionSchema),
  title: z.string().min(1),
  version: z.literal(1),
})

export const DeckVisualSchema = z.object({
  assetRefs: z.array(z.string().min(1)),
  kind: z.enum(['chart', 'code', 'diagram', 'image', 'process', 'table', 'text', 'title-card']),
  prompt: z.string().min(1).optional(),
})

export const DeckComparisonSideSchema = z.object({
  label: z.string().min(1),
  points: z.array(z.string().min(1)),
})

export const DeckComparisonSchema = z.object({
  left: DeckComparisonSideSchema,
  right: DeckComparisonSideSchema,
})

export const DeckProcessStepSchema = z.object({
  detail: z.string().min(1).optional(),
  label: z.string().min(1),
})

export const DeckProcessSchema = z.object({
  steps: z.array(DeckProcessStepSchema).min(2).max(7),
})

export const DeckQuoteSchema = z.object({
  attribution: z.string().min(1).optional(),
  text: z.string().min(1),
})

export const DeckStatSchema = z.object({
  caption: z.string().min(1).optional(),
  label: z.string().min(1),
  value: z.string().min(1),
})

export const DeckChartBarSchema = z.object({
  caption: z.string().min(1).optional(),
  label: z.string().min(1),
  value: z.number().finite().min(0).max(1),
})

export const DeckChartSchema = z.object({
  bars: z.array(DeckChartBarSchema).min(1),
  type: z.enum(['bar', 'donut']).optional(),
  valueLabel: z.string().min(1).optional(),
})

export const DeckCodeBlockSchema = z.object({
  language: z.string().min(1),
  text: z.string().min(1),
})

export const DeckImageSchema = z.object({
  alt: z.string().min(1).optional(),
  caption: z.string().min(1).optional(),
  src: z.string().min(1),
})

export const DeckGridCardSchema = z.object({
  description: z.string().min(1).optional(),
  icon: z.string().min(1).optional(),
  label: z.string().min(1),
})

export const DeckGridCardsSchema = z.object({
  cards: z.array(DeckGridCardSchema).min(2).max(4),
})

export const DeckThemeTokensSchema = z.record(z.string().min(1), z.string().min(1))

export const SlideSchema = z.object({
  blockIds: z.array(z.string().min(1)),
  chart: DeckChartSchema.optional(),
  code: DeckCodeBlockSchema.optional(),
  comparison: DeckComparisonSchema.optional(),
  duration: z.number().finite().positive().optional(),
  evidence: z.array(EvidenceSchema),
  gridCards: DeckGridCardsSchema.optional(),
  image: DeckImageSchema.optional(),
  motion: DeckMotionPresetSchema,
  points: z.array(z.string().min(1)),
  process: DeckProcessSchema.optional(),
  quote: DeckQuoteSchema.optional(),
  slideId: z.string().min(1),
  speakerNote: z.string().optional(),
  stat: DeckStatSchema.optional(),
  subtitle: z.string().optional(),
  title: z.string().min(1),
  transitionOut: DeckTransitionSchema.optional(),
  type: DeckSlideTypeSchema,
  visual: DeckVisualSchema.optional(),
})

export const DeckSchema = z.object({
  format: DeckFormatSchema,
  inputMode: DeckInputModeSchema,
  language: z.string().min(1),
  slides: z.array(SlideSchema),
  theme: DeckThemeSchema,
  themeTokens: DeckThemeTokensSchema.optional(),
  title: z.string().min(1),
  version: z.literal(1),
})

export const SpeakerScriptSegmentSchema = z.object({
  estimatedDuration: z.number().finite().positive().optional(),
  slideId: z.string().min(1),
  text: z.string().min(1),
})

export const SpeakerScriptSchema = z.object({
  language: z.string().min(1),
  mode: DeckInputModeSchema,
  segments: z.array(SpeakerScriptSegmentSchema),
  version: z.literal(1),
})

export const SlideTimingSchema = z.object({
  end: z.number().finite().nonnegative(),
  slideId: z.string().min(1),
  start: z.number().finite().nonnegative(),
}).refine((timing) => timing.end > timing.start, {
  message: 'Slide timing end must be greater than start.',
  path: ['end'],
})

export const TimedDeckSchema = z.object({
  audioRef: z.string().min(1).optional(),
  deck: DeckSchema,
  timings: z.array(SlideTimingSchema),
  version: z.literal(1),
}).superRefine((timedDeck, ctx) => {
  const slideIds = new Set(timedDeck.deck.slides.map((slide) => slide.slideId))
  const timingIds = new Set<string>()

  timedDeck.timings.forEach((timing, index) => {
    if (timingIds.has(timing.slideId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Slide timing must not contain duplicate slideId entries.',
        path: ['timings', index, 'slideId'],
      })
    }

    timingIds.add(timing.slideId)

    if (!slideIds.has(timing.slideId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Slide timing must reference a slide in the deck.',
        path: ['timings', index, 'slideId'],
      })
    }
  })

  timedDeck.deck.slides.forEach((slide, index) => {
    if (!timingIds.has(slide.slideId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Every slide must have a timing entry.',
        path: ['deck', 'slides', index, 'slideId'],
      })
    }
  })
})

export const DeckQualityIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: QualityIssueSeveritySchema,
  slideId: z.string().min(1).optional(),
})

export const DeckSlideQualityMetricsSchema = z.object({
  density: z.enum(['quiet', 'normal', 'dense']),
  duration: z.number().finite().nonnegative(),
  estimatedCharactersPerSecond: z.number().finite().nonnegative(),
  pointCount: z.number().int().nonnegative(),
  slideId: z.string().min(1),
  template: DeckSlideTypeSchema,
  textCharacters: z.number().int().nonnegative(),
  titleCharacters: z.number().int().nonnegative(),
})

export const DeckQualityReportSchema = z.object({
  checkedAt: z.string().min(1),
  format: DeckFormatSchema,
  issues: z.array(DeckQualityIssueSchema),
  metrics: z.array(DeckSlideQualityMetricsSchema),
  motion: z.object({
    trackCount: z.number().int().nonnegative(),
    tracksPerSlide: z.array(z.object({
      presets: z.array(DeckMotionPresetSchema),
      slideId: z.string().min(1),
      trackCount: z.number().int().nonnegative(),
      transitionIn: z.string().min(1).optional(),
      transitionOut: z.string().min(1).optional(),
    })),
    transitionCount: z.number().int().nonnegative(),
  }),
  renderEstimate: z.object({
    estimatedFrames: z.number().int().nonnegative(),
    estimatedRenderSeconds: z.number().finite().nonnegative(),
    fps: z.number().finite().positive(),
  }),
  source: z.literal(TIMED_DECK_ARTIFACT_NAME),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    slides: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
  templateDistribution: z.record(z.string(), z.number().int().nonnegative()),
  textDensity: z.object({
    averageCharacters: z.number().finite().nonnegative(),
    dense: z.number().int().nonnegative(),
    maxCharacters: z.number().int().nonnegative(),
    normal: z.number().int().nonnegative(),
    quiet: z.number().int().nonnegative(),
  }),
  version: z.literal(1),
})

export type ContentBlock = z.infer<typeof ContentBlockSchema>
export type ContentBlocks = z.infer<typeof ContentBlocksSchema>
export type Claim = z.infer<typeof ClaimSchema>
export type Claims = z.infer<typeof ClaimsSchema>
export type Deck = z.infer<typeof DeckSchema>
export type DeckBrief = z.infer<typeof DeckBriefSchema>
export type DeckChart = z.infer<typeof DeckChartSchema>
export type DeckChartBar = z.infer<typeof DeckChartBarSchema>
export type DeckCodeBlock = z.infer<typeof DeckCodeBlockSchema>
export type DeckComparison = z.infer<typeof DeckComparisonSchema>
export type DeckGridCard = z.infer<typeof DeckGridCardSchema>
export type DeckGridCards = z.infer<typeof DeckGridCardsSchema>
export type DeckImage = z.infer<typeof DeckImageSchema>
export type DeckComparisonSide = z.infer<typeof DeckComparisonSideSchema>
export type DeckContentAnalysis = z.infer<typeof DeckContentAnalysisSchema>
export type DeckContentDensity = z.infer<typeof DeckContentDensitySchema>
export type DeckCoherenceReport = z.infer<typeof DeckCoherenceReportSchema>
export type DeckCoverageReport = z.infer<typeof DeckCoverageReportSchema>
export type DeckFormat = z.infer<typeof DeckFormatSchema>
export type DeckInputMode = z.infer<typeof DeckInputModeSchema>
export type DeckMotionPreset = z.infer<typeof DeckMotionPresetSchema>
export type DeckProcess = z.infer<typeof DeckProcessSchema>
export type DeckProcessStep = z.infer<typeof DeckProcessStepSchema>
export type DeckQualityIssue = z.infer<typeof DeckQualityIssueSchema>
export type DeckQualityReport = z.infer<typeof DeckQualityReportSchema>
export type DeckQuote = z.infer<typeof DeckQuoteSchema>
export type DeckSlideType = z.infer<typeof DeckSlideTypeSchema>
export type DeckSlideQualityMetrics = z.infer<typeof DeckSlideQualityMetricsSchema>
export type DeckScriptTimingReport = z.infer<typeof DeckScriptTimingReportSchema>
export type DeckSlideOutline = z.infer<typeof DeckSlideOutlineSchema>
export type DeckSourceMap = z.infer<typeof DeckSourceMapSchema>
export type DeckSourceSection = z.infer<typeof DeckSourceSectionSchema>
export type DeckSourceSectionKind = z.infer<typeof DeckSourceSectionKindSchema>
export type DeckStat = z.infer<typeof DeckStatSchema>
export type DeckTheme = z.infer<typeof DeckThemeSchema>
export type DeckThemeTokens = z.infer<typeof DeckThemeTokensSchema>
export type DeckTimingDriftReport = z.infer<typeof DeckTimingDriftReportSchema>
export type DeckTransition = z.infer<typeof DeckTransitionSchema>
export type DeckTransitionType = z.infer<typeof DeckTransitionTypeSchema>
export type DeckVisual = z.infer<typeof DeckVisualSchema>
export type Document = z.infer<typeof DocumentSchema>
export type DocumentSource = z.infer<typeof DocumentSourceSchema>
export type DocumentSourceType = (typeof DOCUMENT_SOURCE_TYPES)[number]
export type Outline = z.infer<typeof OutlineSchema>
export type OutlineSection = z.infer<typeof OutlineSectionSchema>
export type Slide = z.infer<typeof SlideSchema>
export type SlideTiming = z.infer<typeof SlideTimingSchema>
export type SpeakerScript = z.infer<typeof SpeakerScriptSchema>
export type SpeakerScriptSegment = z.infer<typeof SpeakerScriptSegmentSchema>
export type SourceQuote = z.infer<typeof SourceQuoteSchema>
export type SourceQuotes = z.infer<typeof SourceQuotesSchema>
export type TextDocumentSourceType = (typeof TEXT_DOCUMENT_SOURCE_TYPES)[number]
export type TimedDeck = z.infer<typeof TimedDeckSchema>
