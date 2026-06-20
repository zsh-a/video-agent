import type {DeckSlideType, DeckTransition} from '@video-agent/ir'

import {deckTemplateTypes, findDeckTemplateManifestEntry, maxPointsForDeckTemplate, minPointsForDeckTemplate} from '@video-agent/renderer-deck'
import {z} from 'zod'

import {assertNoGeneratedTextControlSyntax, cleanGeneratedText} from './utils.js'

const LLM_DECK_MOTION_PRESETS = ['fade-in', 'slide-up', 'soft-scale', 'blur-rise', 'stagger-up', 'progressive-reveal', 'card-stack', 'line-draw', 'number-count', 'spotlight', 'wipe', 'zoom-focus', 'cinematic-rise'] as const
const LLM_DECK_CONTENT_BLOCK_TYPES = ['claim', 'context', 'data', 'example', 'quote', 'recommendation', 'summary'] as const
const LLM_DECK_CLAIM_TYPES = ['claim', 'data', 'recommendation', 'summary'] as const
const LLM_DECK_VISUAL_KINDS = ['chart', 'code', 'process', 'table', 'text', 'title-card'] as const
const LLM_DECK_TARGET_PLATFORMS = ['douyin', 'kuaishou', 'bilibili', 'youtube', 'xhs', 'generic'] as const
const LLM_DECK_TRANSITION_TYPES = ['crossfade', 'fade', 'slide-left', 'slide-up'] as const
const LLM_DECK_THEMES = ['elegant-dark', 'clean-white', 'finance-terminal', 'tech-gradient', 'minimal-editorial', 'warm-paper'] as const
const LLM_DECK_POINT_CHARACTERS_MAX = 28
export const LLM_TEXT_DECK_MAX_SLIDES = 24

const LLMDeckSourceRangeSchema = z.tuple([
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative(),
]).refine(([start, end]) => end > start, {
  message: 'Slide sourceRange end must be greater than start.',
})

const LLMGeneratedTextSchema = z.string().min(1).superRefine((value, context) => {
  try {
    assertNoGeneratedTextControlSyntax(value, 'generated text')
    cleanGeneratedText(value, 'generated text')
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Generated text must be clean single-line text.',
    })
  }
})

const LLMTextDeckSlideSemanticSchema = z.object({
  blockText: LLMGeneratedTextSchema,
  blockType: z.enum(LLM_DECK_CONTENT_BLOCK_TYPES),
  claim: z.union([z.object({
    confidence: z.number().min(0).max(1),
    text: LLMGeneratedTextSchema,
    type: z.enum(LLM_DECK_CLAIM_TYPES),
  }), z.null()]),
  momentReason: LLMGeneratedTextSchema,
  momentScore: z.number().min(0).max(1),
  momentSummary: LLMGeneratedTextSchema,
  sourceQuoteText: LLMGeneratedTextSchema,
  visualStyle: LLMGeneratedTextSchema,
})

const LLMTextDeckOutlineSchema = z.object({
  audience: z.string().min(1).optional(),
  sections: z.array(z.object({
    goal: z.string().min(1),
    title: z.string().min(1),
  })).min(1),
})

const LLMDeckChartSchema = z.object({
  bars: z.array(z.object({
    caption: z.string().min(1).optional(),
    label: z.string().min(1),
    value: z.number().finite().min(0).max(1),
  })).min(1).max(4),
  valueLabel: z.string().min(1).optional(),
})

const LLMDeckCodeSchema = z.object({
  language: z.string().min(1),
  text: z.string().min(1),
})

const LLMDeckComparisonSchema = z.object({
  left: z.object({
    label: z.string().min(1),
    points: z.array(z.string().min(1).max(LLM_DECK_POINT_CHARACTERS_MAX)).min(1).max(3),
  }),
  right: z.object({
    label: z.string().min(1),
    points: z.array(z.string().min(1).max(LLM_DECK_POINT_CHARACTERS_MAX)).min(1).max(3),
  }),
})

const LLMDeckQuoteSchema = z.object({
  attribution: z.string().min(1).optional(),
  text: z.string().min(1),
})

const LLMDeckStatSchema = z.object({
  caption: z.string().min(1).optional(),
  label: z.string().min(1),
  value: z.string().min(1),
})

const LLMDeckTransitionOutSchema = z.union([z.object({
  duration: z.number().finite().positive(),
  type: z.enum(LLM_DECK_TRANSITION_TYPES),
}), z.null()])

const LLMDeckVisualSchema = z.object({
  assetRefs: z.array(z.string().min(1)).max(0),
  kind: z.enum(LLM_DECK_VISUAL_KINDS, {error: 'Visual kind must be one of the controlled Deck visual kinds.'}),
})

export const LLMTextDeckContentAnalysisSchema = z.object({
  audience: z.string().min(1).optional(),
  language: z.string().min(1),
  sections: z.array(z.object({
    id: z.string().min(1),
    importance: z.number().min(0).max(1),
    keyClaims: z.array(z.object({
      confidence: z.number().min(0).max(1),
      sourceQuoteText: z.string().min(1),
      text: z.string().min(1),
      type: z.enum(LLM_DECK_CLAIM_TYPES),
    })).min(1),
    mustCover: z.boolean(),
    role: z.string().min(1),
    sourceRange: LLMDeckSourceRangeSchema.optional(),
    summary: z.string().min(1),
    title: z.string().min(1),
    visualRole: z.string().min(1).optional(),
  })).min(1),
  summary: z.string().min(1),
  title: z.string().min(1),
})

export const LLMTextDeckBriefSchema = z.object({
  audience: z.string().min(1).optional(),
  densityPolicy: z.string().min(1),
  language: z.string().min(1),
  narrativeArc: z.array(z.string().min(1)).min(1),
  objective: z.string().min(1),
  optionalSectionIds: z.array(z.string().min(1)),
  requiredSectionIds: z.array(z.string().min(1)),
  styleIntent: z.string().min(1),
  targetDurationSeconds: z.number().finite().positive().optional(),
  targetSlideCount: z.number().int().positive().max(LLM_TEXT_DECK_MAX_SLIDES),
  title: z.string().min(1),
})

export const LLMTextDeckSlideOutlineSchema = z.object({
  slides: z.array(z.object({
    goal: z.string().min(1),
    informationRole: z.string().min(1),
    mustCover: z.boolean(),
    narrationBudgetSeconds: z.number().finite().positive(),
    outlineId: z.string().min(1),
    sourceSectionIds: z.array(z.string().min(1)).min(1),
    templateIntent: z.enum(deckTemplateTypes as [DeckSlideType, ...DeckSlideType[]], {error: 'Template intent must be one of the registered Deck template types.'}),
    visualIntent: z.string().min(1),
  })).min(1).max(LLM_TEXT_DECK_MAX_SLIDES),
})

export const LLMTextDeckSlidePlanSchema = z.object({
  slides: z.array(z.object({
    chart: LLMDeckChartSchema.optional(),
    code: LLMDeckCodeSchema.optional(),
    comparison: LLMDeckComparisonSchema.optional(),
    durationIntent: z.number().finite().positive(),
    motion: z.enum(LLM_DECK_MOTION_PRESETS, {error: 'Motion must be one of the controlled Deck motion presets.'}),
    points: z.array(z.string().min(1).max(LLM_DECK_POINT_CHARACTERS_MAX)),
    quote: LLMDeckQuoteSchema.optional(),
    outlineId: z.string().min(1),
    sectionIds: z.array(z.string().min(1)).min(1),
    stat: LLMDeckStatSchema.optional(),
    subtitle: z.string().min(1).optional(),
    title: z.string().min(1),
    transitionOut: LLMDeckTransitionOutSchema,
    type: z.enum(deckTemplateTypes as [DeckSlideType, ...DeckSlideType[]], {error: 'Slide type must be one of the registered Deck template types.'}),
    visual: LLMDeckVisualSchema,
  })).min(1).max(LLM_TEXT_DECK_MAX_SLIDES),
  targetPlatform: z.enum(LLM_DECK_TARGET_PLATFORMS),
  theme: z.enum(LLM_DECK_THEMES, {error: 'Theme must be one of the supported Deck visual themes.'}),
  title: z.string().min(1),
})

export const LLMTextDeckScriptSemanticsSchema = z.object({
  outline: LLMTextDeckOutlineSchema,
  slides: z.array(z.object({
    duration: z.number().finite().positive(),
    semantic: LLMTextDeckSlideSemanticSchema,
    slideIndex: z.number().int().nonnegative(),
    sourceRange: LLMDeckSourceRangeSchema,
    speakerNote: z.string().min(1),
  })).min(1).max(LLM_TEXT_DECK_MAX_SLIDES),
})

export const LLMTextDeckCoherenceReviewSchema = z.object({
  issues: z.array(z.object({
    code: z.enum(['COHERENCE_GAP', 'TIMING_BUDGET_MISMATCH', 'TEMPLATE_REPETITION', 'LOW_INFORMATION_DEPTH', 'MISSING_PRACTICAL_DETAIL']),
    message: z.string().min(1),
    path: z.string().min(1).optional(),
    severity: z.enum(['error', 'warning']),
    slideIndex: z.number().int().nonnegative().optional(),
    stage: z.enum(['slide-outline', 'slide-plan', 'script-semantics']),
  })),
  summary: z.string().min(1),
})

export const LLMTextDeckPlanSchema = z.object({
  audience: z.string().optional(),
  language: z.string().min(1),
  outline: LLMTextDeckOutlineSchema,
  slides: z.array(z.object({
    chart: LLMDeckChartSchema.optional(),
    code: LLMDeckCodeSchema.optional(),
    comparison: LLMDeckComparisonSchema.optional(),
    duration: z.number().finite().positive(),
    motion: z.enum(LLM_DECK_MOTION_PRESETS, {error: 'Motion must be one of the controlled Deck motion presets.'}),
    points: z.array(z.string().min(1)),
    quote: LLMDeckQuoteSchema.optional(),
    outlineId: z.string().min(1).optional(),
    sectionIds: z.array(z.string().min(1)).optional(),
    semantic: LLMTextDeckSlideSemanticSchema,
    sourceRange: LLMDeckSourceRangeSchema,
    speakerNote: z.string().min(1),
    stat: LLMDeckStatSchema.optional(),
    subtitle: z.string().min(1).optional(),
    title: z.string().min(1),
    transitionOut: LLMDeckTransitionOutSchema,
    type: z.enum(deckTemplateTypes as [DeckSlideType, ...DeckSlideType[]], {error: 'Slide type must be one of the registered Deck template types.'}),
    visual: LLMDeckVisualSchema,
  })).min(1).max(LLM_TEXT_DECK_MAX_SLIDES),
  summary: z.string().min(1),
  targetPlatform: z.enum(LLM_DECK_TARGET_PLATFORMS),
  theme: z.enum(LLM_DECK_THEMES, {error: 'Theme must be one of the supported Deck visual themes.'}),
  title: z.string().min(1),
})

export type LLMTextDeckContentAnalysis = z.infer<typeof LLMTextDeckContentAnalysisSchema>
export type LLMTextDeckBrief = z.infer<typeof LLMTextDeckBriefSchema>
export type LLMTextDeckCoherenceReview = z.infer<typeof LLMTextDeckCoherenceReviewSchema>
export type LLMTextDeckPlan = z.infer<typeof LLMTextDeckPlanSchema>
export type LLMTextDeckScriptSemantics = z.infer<typeof LLMTextDeckScriptSemanticsSchema>
export type LLMTextDeckSlideOutline = z.infer<typeof LLMTextDeckSlideOutlineSchema>
export type LLMTextDeckSlidePlan = z.infer<typeof LLMTextDeckSlidePlanSchema>
type LLMTextDeckSlide = LLMTextDeckPlan['slides'][number]

export type LLMTextDeckSlideSemantic = z.infer<typeof LLMTextDeckSlideSemanticSchema>

export interface LLMTextDeckValidationIssue {
  actual?: number
  code: string
  field?: string
  limit?: number
  message: string
  path?: string
  slideIndex?: number
  slideTitle?: string
  stage: 'final-build' | 'script-semantics' | 'slide-outline' | 'slide-plan'
  template?: DeckSlideType
}

export class LLMTextDeckValidationError extends Error {
  readonly issues: LLMTextDeckValidationIssue[]

  constructor(issues: LLMTextDeckValidationIssue[]) {
    super(formatLLMTextDeckValidationErrorMessage(issues))
    this.name = 'LLMTextDeckValidationError'
    this.issues = issues
  }
}

export interface NormalizedLLMTextDeckSlide extends Omit<LLMTextDeckSlide, 'chart' | 'code' | 'comparison' | 'motion' | 'points' | 'quote' | 'sourceRange' | 'stat' | 'subtitle' | 'transitionOut' | 'type' | 'visual'> {
  chart?: NonNullable<LLMTextDeckSlide['chart']>
  code?: NonNullable<LLMTextDeckSlide['code']>
  comparison?: {
    left: {
      label: string
      points: string[]
    }
    right: {
      label: string
      points: string[]
    }
  }
  motion: LLMTextDeckSlide['motion']
  outlineId?: string
  points: string[]
  quote?: NonNullable<LLMTextDeckSlide['quote']>
  semantic: LLMTextDeckSlideSemantic
  speakerNote: string
  sourceRange: [number, number]
  sectionIds?: string[]
  stat?: NonNullable<LLMTextDeckSlide['stat']>
  subtitle?: string
  transitionOut?: DeckTransition
  type: DeckSlideType
  visual: LLMTextDeckSlide['visual']
}

interface LLMTextDeckTemplateValidationSlide {
  chart?: NonNullable<LLMTextDeckSlide['chart']>
  code?: NonNullable<LLMTextDeckSlide['code']>
  comparison?: {
    left: {
      label: string
      points: string[]
    }
    right: {
      label: string
      points: string[]
    }
  }
  points: string[]
  quote?: NonNullable<LLMTextDeckSlide['quote']>
  stat?: NonNullable<LLMTextDeckSlide['stat']>
  subtitle?: string
  title: string
  type: DeckSlideType
}

export function normalizeLLMTextDeckSlides(plan: LLMTextDeckPlan): NormalizedLLMTextDeckSlide[] {
  const slides = plan.slides.map((slide, index) => {
    const {chart: rawChart, code: rawCode, comparison: rawComparison, quote: rawQuote, sourceRange: rawSourceRange, stat: rawStat, subtitle: rawSubtitle, transitionOut: rawTransitionOut, visual: rawVisual, ...rest} = slide
    const chart = normalizeLLMChart(rawChart)
    const code = normalizeLLMCode(rawCode)
    const title = cleanRequiredLLMText(slide.title, `slide ${index + 1} title`)
    const points = cleanGeneratedPoints(slide.points, `slide ${index + 1} points`)
    const comparison = normalizeLLMComparison(rawComparison)
    const quote = normalizeLLMQuote(rawQuote)
    const speakerNote = cleanRequiredLLMText(slide.speakerNote, `slide ${index + 1} speakerNote`)
    const semantic = normalizeLLMSlideSemantic(slide.semantic, index)
    const sourceRange = normalizeLLMSourceRange(rawSourceRange, index)
    const stat = normalizeLLMStat(rawStat)
    const subtitle = cleanOptionalLLMText(rawSubtitle, `slide ${index + 1} subtitle`)
    const transitionOut = normalizeLLMTransitionOut(rawTransitionOut, index, plan.slides.length)
    const visual = normalizeLLMVisual(rawVisual)

    return {
      ...rest,
      ...(chart === undefined ? {} : {chart}),
      ...(code === undefined ? {} : {code}),
      ...(comparison === undefined ? {} : {comparison}),
      points,
      ...(quote === undefined ? {} : {quote}),
      semantic,
      speakerNote,
      sourceRange,
      ...(stat === undefined ? {} : {stat}),
      ...(subtitle === undefined ? {} : {subtitle}),
      title,
      ...(transitionOut === undefined ? {} : {transitionOut}),
      type: slide.type,
      visual,
    }
  })

  const normalizedSlides = applyLLMTextDeckTemplateConstraints(slides)

  if (normalizedSlides.length === 0) {
    throw new Error('LLM Deck plan did not contain any usable slides.')
  }

  return normalizedSlides
}

export function validateLLMTextDeckSlidePlanTemplateConstraints(plan: LLMTextDeckSlidePlan): void {
  const slides = plan.slides.map((slide, index): LLMTextDeckTemplateValidationSlide => {
    const chart = normalizeLLMChart(slide.chart)
    const code = normalizeLLMCode(slide.code)
    const comparison = normalizeLLMComparison(slide.comparison)
    const points = cleanGeneratedPoints(slide.points, `slide ${index + 1} points`)
    const quote = normalizeLLMQuote(slide.quote)
    const stat = normalizeLLMStat(slide.stat)
    const subtitle = cleanOptionalLLMText(slide.subtitle, `slide ${index + 1} subtitle`)
    const title = cleanRequiredLLMText(slide.title, `slide ${index + 1} title`)

    return {
      ...(chart === undefined ? {} : {chart}),
      ...(code === undefined ? {} : {code}),
      ...(comparison === undefined ? {} : {comparison}),
      points,
      ...(quote === undefined ? {} : {quote}),
      ...(stat === undefined ? {} : {stat}),
      ...(subtitle === undefined ? {} : {subtitle}),
      title,
      type: slide.type,
    }
  })

  applyLLMTextDeckTemplateConstraints(slides)
}

function normalizeLLMSourceRange(sourceRange: LLMTextDeckSlide['sourceRange'], index: number): [number, number] {
  const [start, end] = sourceRange

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error(`LLM Deck plan slide ${index + 1} sourceRange must contain a positive source time range.`)
  }

  return [start, end]
}

function normalizeLLMTransitionOut(transitionOut: LLMTextDeckSlide['transitionOut'] | undefined, index: number, slideCount: number): DeckTransition | undefined {
  const isLastSlide = index === slideCount - 1

  if (isLastSlide) {
    if (transitionOut !== null) {
      throw new Error(`LLM Deck plan final slide ${index + 1} must set transitionOut to null; no runtime transition trimming is allowed.`)
    }

    return undefined
  }

  if (transitionOut === undefined || transitionOut === null) {
    throw new Error(`LLM Deck plan slide ${index + 1} must include transitionOut for the next slide; no template-type transition fallback is allowed.`)
  }

  return {
    duration: transitionOut.duration,
    type: transitionOut.type,
  }
}

function normalizeLLMSlideSemantic(semantic: LLMTextDeckSlideSemantic, index: number): LLMTextDeckSlideSemantic {
  return {
    blockText: cleanRequiredLLMText(semantic.blockText, `slide ${index + 1} semantic.blockText`),
    blockType: semantic.blockType,
    claim: semantic.claim === null
      ? null
      : {
          confidence: semantic.claim.confidence,
          text: cleanRequiredLLMText(semantic.claim.text, `slide ${index + 1} semantic.claim.text`),
          type: semantic.claim.type,
        },
    momentReason: cleanRequiredLLMText(semantic.momentReason, `slide ${index + 1} semantic.momentReason`),
    momentScore: semantic.momentScore,
    momentSummary: cleanRequiredLLMText(semantic.momentSummary, `slide ${index + 1} semantic.momentSummary`),
    sourceQuoteText: cleanRequiredLLMText(semantic.sourceQuoteText, `slide ${index + 1} semantic.sourceQuoteText`),
    visualStyle: cleanRequiredLLMText(semantic.visualStyle, `slide ${index + 1} semantic.visualStyle`),
  }
}

function applyLLMTextDeckTemplateConstraints<T extends LLMTextDeckTemplateValidationSlide>(slides: T[]): T[] {
  const issues = slides.flatMap((slide, index) => collectLLMSlideTemplateIssues(slide, index))

  if (issues.length > 0) {
    throw new LLMTextDeckValidationError(issues)
  }

  return slides
}

function collectLLMSlideTemplateIssues(slide: LLMTextDeckTemplateValidationSlide, slideIndex: number): LLMTextDeckValidationIssue[] {
  const issues: LLMTextDeckValidationIssue[] = []
  const maxPoints = maxPointsForDeckTemplate(slide.type)

  if (maxPoints !== undefined && slide.points.length > maxPoints) {
    issues.push(createLLMSlideTemplateIssue(slide, slideIndex, {
      actual: slide.points.length,
      code: 'TEMPLATE_POINT_COUNT_LIMIT',
      field: 'points',
      limit: maxPoints,
      message: `LLM Deck plan slide "${slide.title}" has ${slide.points.length} points, exceeding ${slide.type} limit ${maxPoints}. Split or rewrite the slide in LLM output.`,
      path: `slides[${slideIndex}].points`,
    }))
  }

  const minPoints = minPointsForDeckTemplate(slide.type)

  if (minPoints !== undefined && slide.points.length < minPoints) {
    issues.push(createLLMSlideTemplateIssue(slide, slideIndex, {
      actual: slide.points.length,
      code: 'TEMPLATE_POINT_COUNT_MINIMUM',
      field: 'points',
      limit: minPoints,
      message: `LLM Deck plan slide "${slide.title}" has ${slide.points.length} points, below ${slide.type} minimum ${minPoints}. Rewrite the slide in LLM output.`,
      path: `slides[${slideIndex}].points`,
    }))
  }

  issues.push(...collectLLMSlideTemplateDataIssues(slide, slideIndex))

  const limits = findDeckTemplateManifestEntry(slide.type).limits

  pushTextLimitIssue(issues, slide, slideIndex, 'title', `slides[${slideIndex}].title`, slide.title, limits.title_chars)
  pushTextLimitIssue(issues, slide, slideIndex, 'subtitle', `slides[${slideIndex}].subtitle`, slide.subtitle, limits.subtitle_chars)

  for (const [index, point] of slide.points.entries()) {
    pushTextLimitIssue(issues, slide, slideIndex, `point ${index + 1}`, `slides[${slideIndex}].points[${index}]`, point, limits.point_chars)
  }

  if (slide.comparison !== undefined && limits.left_points !== undefined && slide.comparison.left.points.length > limits.left_points) {
    issues.push(createLLMSlideTemplateIssue(slide, slideIndex, {
      actual: slide.comparison.left.points.length,
      code: 'TEMPLATE_COMPARISON_LEFT_COUNT_LIMIT',
      field: 'comparison.left.points',
      limit: limits.left_points,
      message: `LLM Deck plan slide "${slide.title}" has ${slide.comparison.left.points.length} left comparison points, exceeding ${slide.type} limit ${limits.left_points}.`,
      path: `slides[${slideIndex}].comparison.left.points`,
    }))
  }

  if (slide.comparison !== undefined && limits.right_points !== undefined && slide.comparison.right.points.length > limits.right_points) {
    issues.push(createLLMSlideTemplateIssue(slide, slideIndex, {
      actual: slide.comparison.right.points.length,
      code: 'TEMPLATE_COMPARISON_RIGHT_COUNT_LIMIT',
      field: 'comparison.right.points',
      limit: limits.right_points,
      message: `LLM Deck plan slide "${slide.title}" has ${slide.comparison.right.points.length} right comparison points, exceeding ${slide.type} limit ${limits.right_points}.`,
      path: `slides[${slideIndex}].comparison.right.points`,
    }))
  }

  if (slide.chart !== undefined && limits.bars !== undefined && slide.chart.bars.length > limits.bars) {
    issues.push(createLLMSlideTemplateIssue(slide, slideIndex, {
      actual: slide.chart.bars.length,
      code: 'TEMPLATE_CHART_BAR_COUNT_LIMIT',
      field: 'chart.bars',
      limit: limits.bars,
      message: `LLM Deck plan slide "${slide.title}" has ${slide.chart.bars.length} chart bars, exceeding ${slide.type} limit ${limits.bars}.`,
      path: `slides[${slideIndex}].chart.bars`,
    }))
  }

  for (const [index, point] of slide.comparison?.left.points.entries() ?? []) {
    pushTextLimitIssue(issues, slide, slideIndex, `left comparison point ${index + 1}`, `slides[${slideIndex}].comparison.left.points[${index}]`, point, limits.point_chars)
  }

  for (const [index, point] of slide.comparison?.right.points.entries() ?? []) {
    pushTextLimitIssue(issues, slide, slideIndex, `right comparison point ${index + 1}`, `slides[${slideIndex}].comparison.right.points[${index}]`, point, limits.point_chars)
  }

  for (const [index, bar] of slide.chart?.bars.entries() ?? []) {
    pushTextLimitIssue(issues, slide, slideIndex, `chart bar ${index + 1} label`, `slides[${slideIndex}].chart.bars[${index}].label`, bar.label, limits.point_chars)
  }

  return issues
}

function collectLLMSlideTemplateDataIssues(slide: LLMTextDeckTemplateValidationSlide, slideIndex: number): LLMTextDeckValidationIssue[] {
  return [
    ...collectExclusiveTemplateDataIssues(slide, slideIndex, 'chart', slide.chart, 'chart data'),
    ...collectExclusiveTemplateDataIssues(slide, slideIndex, 'code', slide.code, 'code data'),
    ...collectExclusiveTemplateDataIssues(slide, slideIndex, 'comparison', slide.comparison, 'comparison data'),
    ...collectExclusiveTemplateDataIssues(slide, slideIndex, 'quote', slide.quote, 'quote data'),
    ...collectExclusiveTemplateDataIssues(slide, slideIndex, 'stat', slide.stat, 'stat data'),
  ]
}

function collectExclusiveTemplateDataIssues(slide: LLMTextDeckTemplateValidationSlide, slideIndex: number, templateType: DeckSlideType, value: unknown, label: string): LLMTextDeckValidationIssue[] {
  if (slide.type === templateType && value === undefined) {
    return [createLLMSlideTemplateIssue(slide, slideIndex, {
      code: 'TEMPLATE_REQUIRED_DATA_MISSING',
      field: templateType,
      message: `LLM Deck plan slide "${slide.title}" uses ${templateType} template without ${label}. Rewrite the slide in LLM output.`,
      path: `slides[${slideIndex}].${templateType}`,
    })]
  }

  if (slide.type !== templateType && value !== undefined) {
    return [createLLMSlideTemplateIssue(slide, slideIndex, {
      code: 'TEMPLATE_EXTRANEOUS_DATA',
      field: templateType,
      message: `LLM Deck plan slide "${slide.title}" includes ${label} on non-${templateType} template ${slide.type}. Rewrite the slide in LLM output.`,
      path: `slides[${slideIndex}].${templateType}`,
    })]
  }

  return []
}

function pushTextLimitIssue(
  issues: LLMTextDeckValidationIssue[],
  slide: LLMTextDeckTemplateValidationSlide,
  slideIndex: number,
  field: string,
  path: string,
  value: string | undefined,
  limit: number | undefined,
): void {
  if (limit !== undefined && (value?.length ?? 0) > limit) {
    issues.push(createLLMSlideTemplateIssue(slide, slideIndex, {
      actual: value?.length ?? 0,
      code: 'TEMPLATE_TEXT_LENGTH_LIMIT',
      field,
      limit,
      message: `LLM Deck plan slide "${slide.title}" ${field} has ${value?.length ?? 0} characters, exceeding ${slide.type} limit ${limit}. Rewrite the slide in LLM output.`,
      path,
    }))
  }
}

function createLLMSlideTemplateIssue(
  slide: LLMTextDeckTemplateValidationSlide,
  slideIndex: number,
  issue: Omit<LLMTextDeckValidationIssue, 'slideIndex' | 'slideTitle' | 'stage' | 'template'>,
): LLMTextDeckValidationIssue {
  return {
    ...issue,
    slideIndex,
    slideTitle: slide.title,
    stage: 'slide-plan',
    template: slide.type,
  }
}

function formatLLMTextDeckValidationErrorMessage(issues: LLMTextDeckValidationIssue[]): string {
  const first = issues[0]

  if (first === undefined) {
    return 'LLM Deck plan failed validation.'
  }

  return issues.length === 1
    ? first.message
    : `${first.message} ${issues.length - 1} additional validation issue(s) found.`
}

function cleanRequiredLLMText(value: string, field: string): string {
  assertNoGeneratedTextControlSyntax(value, field)

  const cleaned = cleanGeneratedText(value, field)

  if (cleaned === '') {
    throw new Error(`LLM Deck plan ${field} is empty.`)
  }

  return cleaned
}

function cleanOptionalLLMText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  assertNoGeneratedTextControlSyntax(value, field)

  const cleaned = cleanGeneratedText(value, field)

  if (cleaned === '') {
    throw new Error(`LLM Deck plan ${field} is empty.`)
  }

  return cleaned
}

function normalizeLLMComparison(comparison: LLMTextDeckSlide['comparison']): NormalizedLLMTextDeckSlide['comparison'] {
  if (comparison === undefined) {
    return undefined
  }

  const leftLabel = cleanRequiredLLMText(comparison.left.label, 'comparison.left.label')
  const rightLabel = cleanRequiredLLMText(comparison.right.label, 'comparison.right.label')
  const leftPoints = cleanGeneratedPoints(comparison.left.points, 'comparison.left.points')
  const rightPoints = cleanGeneratedPoints(comparison.right.points, 'comparison.right.points')

  if (leftLabel === '' || rightLabel === '' || leftPoints.length === 0 || rightPoints.length === 0) {
    throw new Error('LLM Deck plan comparison is incomplete. Rewrite the slide in LLM output.')
  }

  return {
    left: {
      label: leftLabel,
      points: leftPoints,
    },
    right: {
      label: rightLabel,
      points: rightPoints,
    },
  }
}

function normalizeLLMChart(chart: LLMTextDeckSlide['chart']): NormalizedLLMTextDeckSlide['chart'] {
  if (chart === undefined) {
    return undefined
  }

  const bars = chart.bars.map((bar, index) => ({
    ...(bar.caption === undefined ? {} : {caption: cleanRequiredLLMText(bar.caption, `chart.bars[${index}].caption`)}),
    label: cleanRequiredLLMText(bar.label, `chart.bars[${index}].label`),
    value: bar.value,
  }))
  const valueLabel = cleanOptionalLLMText(chart.valueLabel, 'chart.valueLabel')

  if (bars.length === 0) {
    throw new Error('LLM Deck plan chart is incomplete. Rewrite the slide in LLM output.')
  }

  return {
    bars,
    ...(valueLabel === undefined ? {} : {valueLabel}),
  }
}

function normalizeLLMQuote(quote: LLMTextDeckSlide['quote']): NormalizedLLMTextDeckSlide['quote'] {
  if (quote === undefined) {
    return undefined
  }

  return {
    ...(quote.attribution === undefined ? {} : {attribution: cleanRequiredLLMText(quote.attribution, 'quote.attribution')}),
    text: cleanRequiredLLMText(quote.text, 'quote.text'),
  }
}

function normalizeLLMStat(stat: LLMTextDeckSlide['stat']): NormalizedLLMTextDeckSlide['stat'] {
  if (stat === undefined) {
    return undefined
  }

  return {
    ...(stat.caption === undefined ? {} : {caption: cleanRequiredLLMText(stat.caption, 'stat.caption')}),
    label: cleanRequiredLLMText(stat.label, 'stat.label'),
    value: cleanRequiredLLMText(stat.value, 'stat.value'),
  }
}

function normalizeLLMCode(code: LLMTextDeckSlide['code']): NormalizedLLMTextDeckSlide['code'] {
  if (code === undefined) {
    return undefined
  }

  return {
    language: cleanRequiredLLMText(code.language, 'code.language'),
    text: cleanRequiredLLMCodeText(code.text, 'code.text'),
  }
}

function normalizeLLMVisual(visual: LLMTextDeckSlide['visual']): NormalizedLLMTextDeckSlide['visual'] {
  const assetRefs = normalizeLLMAssetRefs(visual.assetRefs)
  const kind = visual.kind as string

  if (kind === 'diagram' || kind === 'image') {
    throw new Error(`LLM Deck plan visual.kind "${kind}" is not renderable by the Deck renderer. Rewrite the slide with a supported visual kind or concrete template data; no unrendered visual prompt fallback is allowed.`)
  }

  return {
    assetRefs,
    kind: visual.kind,
  }
}

function normalizeLLMAssetRefs(assetRefs: string[]): string[] {
  const seen = new Set<string>()

  return assetRefs.map((assetRef, index) => {
    assertNoGeneratedTextControlSyntax(assetRef, `visual.assetRefs[${index}]`)

    const cleaned = cleanGeneratedText(assetRef, `visual.assetRefs[${index}]`)

    if (cleaned === '') {
      throw new Error(`LLM Deck plan visual.assetRefs[${index}] is empty.`)
    }

    if (seen.has(cleaned)) {
      throw new Error(`LLM Deck plan visual.assetRefs[${index}] duplicates asset ref "${cleaned}". Return unique LLM-selected asset refs; no runtime assetRef dedupe is allowed.`)
    }

    seen.add(cleaned)

    return cleaned
  })
}

function cleanGeneratedPoints(points: string[], field: string): string[] {
  return points.map((point, index) => cleanRequiredLLMText(point, `${field}[${index}]`))
}

function cleanRequiredLLMCodeText(value: string, field: string): string {
  if (/```/u.test(value)) {
    throw new Error(`LLM Deck plan ${field} contains Markdown code fences. Rewrite the code field in LLM output; no runtime code-fence cleanup is allowed.`)
  }

  if (/\r/u.test(value)) {
    throw new Error(`LLM Deck plan ${field} contains CR or CRLF line endings. Rewrite the code field with LF line endings; no runtime line-ending repair is allowed.`)
  }

  if (value.trim() === '') {
    throw new Error(`LLM Deck plan ${field} is empty.`)
  }

  return value
}
