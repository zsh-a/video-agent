import {z} from 'zod'

import {EvidenceSchema} from './storyboard.js'

export const DeckFormatSchema = z.enum(['landscape_1920x1080', 'portrait_1080x1920', 'square_1080x1080'])

export const DeckInputModeSchema = z.enum(['script-generated', 'audio-anchored'])

export const DeckThemeSchema = z.enum([
  'auto',
  'elegant-dark',
  'clean-white',
  'finance-terminal',
  'tech-gradient',
  'minimal-editorial',
  'warm-paper',
  'custom',
])

export const DeckMotionPresetSchema = z.enum([
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
  'rotate',
  'spin',
  'spring',
  'bounce',
  'typewriter',
  'parallax',
])

export const DeckTransitionTypeSchema = z.enum(['crossfade', 'fade', 'slide-left', 'slide-up'])

export const DeckTransitionSchema = z.object({
  duration: z.number().finite().positive(),
  type: DeckTransitionTypeSchema,
})

export const DeckSlideTypeSchema = z.enum([
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
])

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
  sourceType: z.enum(['audio', 'html', 'markdown', 'pdf', 'text']),
  title: z.string().optional(),
  url: z.string().url().optional(),
})

export const ContentBlockSchema = z.object({
  evidence: z.array(EvidenceSchema),
  id: z.string().min(1),
  sourceRange: DeckSourceRangeSchema,
  text: z.string().min(1),
  type: z.enum(['claim', 'context', 'data', 'example', 'quote', 'recommendation', 'summary']),
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

export const ClaimSchema = z.object({
  blockId: z.string().min(1),
  confidence: z.number().finite().min(0).max(1),
  evidence: z.array(EvidenceSchema),
  id: z.string().min(1),
  text: z.string().min(1),
  type: z.enum(['claim', 'data', 'recommendation', 'summary']),
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
  valueLabel: z.string().min(1).optional(),
})

export const DeckCodeBlockSchema = z.object({
  language: z.string().min(1),
  text: z.string().min(1),
})

export const DeckThemeTokensSchema = z.record(z.string().min(1), z.string().min(1))

export const SlideSchema = z.object({
  blockIds: z.array(z.string().min(1)),
  chart: DeckChartSchema.optional(),
  code: DeckCodeBlockSchema.optional(),
  comparison: DeckComparisonSchema.optional(),
  duration: z.number().finite().positive().optional(),
  evidence: z.array(EvidenceSchema),
  motion: DeckMotionPresetSchema,
  points: z.array(z.string().min(1)),
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
}).refine((timing) => timing.end >= timing.start, {
  message: 'Slide timing end must be greater than or equal to start.',
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
  severity: z.enum(['error', 'warning']),
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
  source: z.literal('timed-deck.json'),
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
export type DeckChart = z.infer<typeof DeckChartSchema>
export type DeckChartBar = z.infer<typeof DeckChartBarSchema>
export type DeckCodeBlock = z.infer<typeof DeckCodeBlockSchema>
export type DeckComparison = z.infer<typeof DeckComparisonSchema>
export type DeckComparisonSide = z.infer<typeof DeckComparisonSideSchema>
export type DeckFormat = z.infer<typeof DeckFormatSchema>
export type DeckInputMode = z.infer<typeof DeckInputModeSchema>
export type DeckMotionPreset = z.infer<typeof DeckMotionPresetSchema>
export type DeckQualityIssue = z.infer<typeof DeckQualityIssueSchema>
export type DeckQualityReport = z.infer<typeof DeckQualityReportSchema>
export type DeckQuote = z.infer<typeof DeckQuoteSchema>
export type DeckSlideType = z.infer<typeof DeckSlideTypeSchema>
export type DeckSlideQualityMetrics = z.infer<typeof DeckSlideQualityMetricsSchema>
export type DeckStat = z.infer<typeof DeckStatSchema>
export type DeckTheme = z.infer<typeof DeckThemeSchema>
export type DeckThemeTokens = z.infer<typeof DeckThemeTokensSchema>
export type DeckTransition = z.infer<typeof DeckTransitionSchema>
export type DeckTransitionType = z.infer<typeof DeckTransitionTypeSchema>
export type DeckVisual = z.infer<typeof DeckVisualSchema>
export type Document = z.infer<typeof DocumentSchema>
export type DocumentSource = z.infer<typeof DocumentSourceSchema>
export type Outline = z.infer<typeof OutlineSchema>
export type OutlineSection = z.infer<typeof OutlineSectionSchema>
export type Slide = z.infer<typeof SlideSchema>
export type SlideTiming = z.infer<typeof SlideTimingSchema>
export type SpeakerScript = z.infer<typeof SpeakerScriptSchema>
export type SpeakerScriptSegment = z.infer<typeof SpeakerScriptSegmentSchema>
export type SourceQuote = z.infer<typeof SourceQuoteSchema>
export type SourceQuotes = z.infer<typeof SourceQuotesSchema>
export type TimedDeck = z.infer<typeof TimedDeckSchema>
