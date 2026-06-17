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
])

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

export const DocumentSourceSchema = z.object({
  author: z.string().optional(),
  language: z.string().default('zh-CN'),
  path: z.string().min(1).optional(),
  sourceType: z.enum(['audio', 'html', 'markdown', 'pdf', 'text']),
  title: z.string().optional(),
  url: z.string().url().optional(),
})

export const ContentBlockSchema = z.object({
  evidence: z.array(EvidenceSchema).default([]),
  id: z.string().min(1),
  sourceRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
  text: z.string().min(1),
  type: z.enum(['claim', 'context', 'data', 'example', 'quote', 'recommendation', 'summary']),
}).refine((block) => block.sourceRange === undefined || block.sourceRange[1] >= block.sourceRange[0], {
  message: 'Content block sourceRange end must be greater than or equal to start.',
  path: ['sourceRange'],
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
  confidence: z.number().finite().min(0).max(1).default(0.7),
  evidence: z.array(EvidenceSchema).default([]),
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
  evidence: z.array(EvidenceSchema).default([]),
  id: z.string().min(1),
  sourceRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
  text: z.string().min(1),
})

export const SourceQuotesSchema = z.object({
  quotes: z.array(SourceQuoteSchema),
  version: z.literal(1),
})

export const OutlineSectionSchema = z.object({
  blockIds: z.array(z.string().min(1)).default([]),
  duration: z.number().finite().positive().optional(),
  goal: z.string().min(1),
  id: z.string().min(1),
  title: z.string().min(1),
})

export const OutlineSchema = z.object({
  audience: z.string().optional(),
  durationTarget: z.number().finite().positive().optional(),
  language: z.string().default('zh-CN'),
  sections: z.array(OutlineSectionSchema),
  title: z.string().min(1),
  version: z.literal(1),
})

export const DeckVisualSchema = z.object({
  assetRefs: z.array(z.string().min(1)).default([]),
  chartDataRef: z.string().min(1).optional(),
  kind: z.enum(['chart', 'code', 'diagram', 'image', 'process', 'table', 'text', 'title-card']),
  prompt: z.string().min(1).optional(),
})

export const DeckComparisonSideSchema = z.object({
  label: z.string().min(1),
  points: z.array(z.string().min(1)).default([]),
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

export const DeckCodeBlockSchema = z.object({
  language: z.string().min(1).default('text'),
  text: z.string().min(1),
})

export const SlideSchema = z.object({
  blockIds: z.array(z.string().min(1)).default([]),
  code: DeckCodeBlockSchema.optional(),
  comparison: DeckComparisonSchema.optional(),
  duration: z.number().finite().positive().optional(),
  evidence: z.array(EvidenceSchema).default([]),
  motion: DeckMotionPresetSchema.default('progressive-reveal'),
  points: z.array(z.string().min(1)).default([]),
  quote: DeckQuoteSchema.optional(),
  slideId: z.string().min(1),
  speakerNote: z.string().optional(),
  stat: DeckStatSchema.optional(),
  subtitle: z.string().optional(),
  title: z.string().min(1),
  type: DeckSlideTypeSchema,
  visual: DeckVisualSchema.optional(),
})

export const DeckSchema = z.object({
  format: DeckFormatSchema.default('portrait_1080x1920'),
  inputMode: DeckInputModeSchema.default('script-generated'),
  language: z.string().default('zh-CN'),
  slides: z.array(SlideSchema),
  theme: DeckThemeSchema.default('elegant-dark'),
  title: z.string().min(1),
  version: z.literal(1),
})

export const SpeakerScriptSegmentSchema = z.object({
  estimatedDuration: z.number().finite().positive().optional(),
  slideId: z.string().min(1),
  text: z.string().min(1),
})

export const SpeakerScriptSchema = z.object({
  language: z.string().default('zh-CN'),
  mode: DeckInputModeSchema.default('script-generated'),
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

  timedDeck.timings.forEach((timing, index) => {
    if (!slideIds.has(timing.slideId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Slide timing must reference a slide in the deck.',
        path: ['timings', index, 'slideId'],
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
  duration: z.number().finite().nonnegative(),
  estimatedCharactersPerSecond: z.number().finite().nonnegative(),
  pointCount: z.number().int().nonnegative(),
  slideId: z.string().min(1),
  textCharacters: z.number().int().nonnegative(),
  titleCharacters: z.number().int().nonnegative(),
})

export const DeckQualityReportSchema = z.object({
  checkedAt: z.string().min(1),
  format: DeckFormatSchema,
  issues: z.array(DeckQualityIssueSchema),
  metrics: z.array(DeckSlideQualityMetricsSchema),
  source: z.literal('timed-deck.json'),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    slides: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
  version: z.literal(1),
})

export type ContentBlock = z.infer<typeof ContentBlockSchema>
export type ContentBlocks = z.infer<typeof ContentBlocksSchema>
export type Claim = z.infer<typeof ClaimSchema>
export type Claims = z.infer<typeof ClaimsSchema>
export type Deck = z.infer<typeof DeckSchema>
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
