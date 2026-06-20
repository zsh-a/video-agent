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
export const LLM_TEXT_DECK_MAX_SLIDES = 24

const LLMDeckSourceRangeSchema = z.tuple([
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative(),
]).refine(([start, end]) => end > start, {
  message: 'Slide sourceRange end must be greater than start.',
})

const LLMTextDeckSlideSemanticSchema = z.object({
  blockText: z.string().min(1),
  blockType: z.enum(LLM_DECK_CONTENT_BLOCK_TYPES),
  claim: z.union([z.object({
    confidence: z.number().min(0).max(1),
    text: z.string().min(1),
    type: z.enum(LLM_DECK_CLAIM_TYPES),
  }), z.null()]),
  momentReason: z.string().min(1),
  momentScore: z.number().min(0).max(1),
  momentSummary: z.string().min(1),
  sourceQuoteText: z.string().min(1),
  visualStyle: z.string().min(1),
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
    points: z.array(z.string().min(1)),
  }),
  right: z.object({
    label: z.string().min(1),
    points: z.array(z.string().min(1)),
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
    sourceRange: LLMDeckSourceRangeSchema.optional(),
    summary: z.string().min(1),
    title: z.string().min(1),
  })).min(1),
  summary: z.string().min(1),
  title: z.string().min(1),
})

export const LLMTextDeckSlidePlanSchema = z.object({
  slides: z.array(z.object({
    chart: LLMDeckChartSchema.optional(),
    code: LLMDeckCodeSchema.optional(),
    comparison: LLMDeckComparisonSchema.optional(),
    durationIntent: z.number().finite().positive(),
    motion: z.enum(LLM_DECK_MOTION_PRESETS, {error: 'Motion must be one of the controlled Deck motion presets.'}),
    points: z.array(z.string().min(1)),
    quote: LLMDeckQuoteSchema.optional(),
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
export type LLMTextDeckPlan = z.infer<typeof LLMTextDeckPlanSchema>
export type LLMTextDeckScriptSemantics = z.infer<typeof LLMTextDeckScriptSemanticsSchema>
export type LLMTextDeckSlidePlan = z.infer<typeof LLMTextDeckSlidePlanSchema>
type LLMTextDeckSlide = LLMTextDeckPlan['slides'][number]

export type LLMTextDeckSlideSemantic = z.infer<typeof LLMTextDeckSlideSemanticSchema>

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
  points: string[]
  quote?: NonNullable<LLMTextDeckSlide['quote']>
  semantic: LLMTextDeckSlideSemantic
  speakerNote: string
  sourceRange: [number, number]
  stat?: NonNullable<LLMTextDeckSlide['stat']>
  subtitle?: string
  transitionOut?: DeckTransition
  type: DeckSlideType
  visual: LLMTextDeckSlide['visual']
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

function applyLLMTextDeckTemplateConstraints(slides: NormalizedLLMTextDeckSlide[]): NormalizedLLMTextDeckSlide[] {
  return slides.map((slide) => applyLLMTextDeckTemplateConstraint(slide))
}

function applyLLMTextDeckTemplateConstraint(slide: NormalizedLLMTextDeckSlide): NormalizedLLMTextDeckSlide {
  assertLLMSlideTemplateLimits(slide)

  return slide
}

function assertLLMSlideTemplateLimits(slide: NormalizedLLMTextDeckSlide): void {
  const maxPoints = maxPointsForDeckTemplate(slide.type)

  if (maxPoints !== undefined && slide.points.length > maxPoints) {
    throw new Error(`LLM Deck plan slide "${slide.title}" has ${slide.points.length} points, exceeding ${slide.type} limit ${maxPoints}. Split or rewrite the slide in LLM output.`)
  }

  const minPoints = minPointsForDeckTemplate(slide.type)

  if (minPoints !== undefined && slide.points.length < minPoints) {
    throw new Error(`LLM Deck plan slide "${slide.title}" has ${slide.points.length} points, below ${slide.type} minimum ${minPoints}. Rewrite the slide in LLM output.`)
  }

  assertLLMSlideTemplateData(slide)

  const limits = findDeckTemplateManifestEntry(slide.type).limits

  assertTextLimit(slide, 'title', slide.title, limits.title_chars)
  assertTextLimit(slide, 'subtitle', slide.subtitle, limits.subtitle_chars)

  for (const [index, point] of slide.points.entries()) {
    assertTextLimit(slide, `point ${index + 1}`, point, limits.point_chars)
  }

  if (slide.comparison !== undefined && limits.left_points !== undefined && slide.comparison.left.points.length > limits.left_points) {
    throw new Error(`LLM Deck plan slide "${slide.title}" has ${slide.comparison.left.points.length} left comparison points, exceeding ${slide.type} limit ${limits.left_points}.`)
  }

  if (slide.comparison !== undefined && limits.right_points !== undefined && slide.comparison.right.points.length > limits.right_points) {
    throw new Error(`LLM Deck plan slide "${slide.title}" has ${slide.comparison.right.points.length} right comparison points, exceeding ${slide.type} limit ${limits.right_points}.`)
  }

  if (slide.chart !== undefined && limits.bars !== undefined && slide.chart.bars.length > limits.bars) {
    throw new Error(`LLM Deck plan slide "${slide.title}" has ${slide.chart.bars.length} chart bars, exceeding ${slide.type} limit ${limits.bars}.`)
  }

  for (const [index, point] of slide.comparison?.left.points.entries() ?? []) {
    assertTextLimit(slide, `left comparison point ${index + 1}`, point, limits.point_chars)
  }

  for (const [index, point] of slide.comparison?.right.points.entries() ?? []) {
    assertTextLimit(slide, `right comparison point ${index + 1}`, point, limits.point_chars)
  }

  for (const [index, bar] of slide.chart?.bars.entries() ?? []) {
    assertTextLimit(slide, `chart bar ${index + 1} label`, bar.label, limits.point_chars)
  }
}

function assertLLMSlideTemplateData(slide: NormalizedLLMTextDeckSlide): void {
  assertExclusiveTemplateData(slide, 'chart', slide.chart, 'chart data')
  assertExclusiveTemplateData(slide, 'code', slide.code, 'code data')
  assertExclusiveTemplateData(slide, 'comparison', slide.comparison, 'comparison data')
  assertExclusiveTemplateData(slide, 'quote', slide.quote, 'quote data')
  assertExclusiveTemplateData(slide, 'stat', slide.stat, 'stat data')
}

function assertExclusiveTemplateData(slide: NormalizedLLMTextDeckSlide, templateType: DeckSlideType, value: unknown, label: string): void {
  if (slide.type === templateType && value === undefined) {
    throw new Error(`LLM Deck plan slide "${slide.title}" uses ${templateType} template without ${label}. Rewrite the slide in LLM output.`)
  }

  if (slide.type !== templateType && value !== undefined) {
    throw new Error(`LLM Deck plan slide "${slide.title}" includes ${label} on non-${templateType} template ${slide.type}. Rewrite the slide in LLM output.`)
  }
}

function assertTextLimit(slide: NormalizedLLMTextDeckSlide, field: string, value: string | undefined, limit: number | undefined): void {
  if (limit !== undefined && (value?.length ?? 0) > limit) {
    throw new Error(`LLM Deck plan slide "${slide.title}" ${field} has ${value?.length ?? 0} characters, exceeding ${slide.type} limit ${limit}. Rewrite the slide in LLM output.`)
  }
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
