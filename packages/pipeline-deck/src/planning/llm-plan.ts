import type {DeckSlideType, Slide} from '@video-agent/ir'

import {findDeckTemplateManifestEntry, isDeckTemplateType, maxPointsForDeckTemplate} from '@video-agent/renderer-deck'
import {z} from 'zod'

import {chunk, cleanGeneratedText} from './utils.js'

const LLM_DECK_MOTION_PRESETS = ['fade-in', 'slide-up', 'soft-scale', 'blur-rise', 'stagger-up', 'progressive-reveal', 'card-stack', 'line-draw', 'number-count', 'spotlight', 'wipe', 'zoom-focus', 'cinematic-rise'] as const

export const LLMTextDeckPlanSchema = z.object({
  audience: z.string().optional(),
  slides: z.array(z.object({
    code: z.object({
      language: z.string().min(1).default('text'),
      text: z.string().min(1),
    }).optional(),
    comparison: z.object({
      left: z.object({
        label: z.string().min(1),
        points: z.array(z.string().min(1)).default([]),
      }),
      right: z.object({
        label: z.string().min(1),
        points: z.array(z.string().min(1)).default([]),
      }),
    }).optional(),
    duration: z.number().finite().positive().optional(),
    motion: z.string().min(1).optional(),
    points: z.array(z.string().min(1)).default([]),
    quote: z.object({
      attribution: z.string().min(1).optional(),
      text: z.string().min(1),
    }).optional(),
    speakerNote: z.string().optional(),
    stat: z.object({
      caption: z.string().min(1).optional(),
      label: z.string().min(1),
      value: z.string().min(1),
    }).optional(),
    subtitle: z.string().min(1).optional(),
    title: z.string().min(1),
    type: z.string().min(1).optional(),
  })).min(1).max(24),
  summary: z.string().min(1),
  theme: z.string().min(1).optional(),
  title: z.string().min(1),
})

export type LLMTextDeckPlan = z.infer<typeof LLMTextDeckPlanSchema>
type LLMTextDeckSlide = LLMTextDeckPlan['slides'][number]

export interface NormalizedLLMTextDeckSlide extends Omit<LLMTextDeckSlide, 'comparison' | 'motion' | 'points' | 'subtitle' | 'type'> {
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
  motion?: Slide['motion']
  points: string[]
  speakerNote: string
  subtitle?: string
  type: DeckSlideType
}

export function normalizeLLMTextDeckSlides(plan: LLMTextDeckPlan): NormalizedLLMTextDeckSlide[] {
  const slides = plan.slides.map((slide, index) => {
    const {comparison: rawComparison, motion: rawMotion, subtitle: rawSubtitle, type: rawType, ...rest} = slide
    const title = cleanGeneratedText(slide.title, `第 ${index + 1} 页`).slice(0, 72)
    const points = slide.points
      .map((point) => cleanGeneratedText(point, ''))
      .filter((point) => point !== '' && point !== title)
      .slice(0, 16)
    const comparison = normalizeLLMComparison(rawComparison)
    const speakerNote = cleanGeneratedText(slide.speakerNote, [title, ...points].join('。'))
    const subtitle = cleanGeneratedText(rawSubtitle, '')
    const motion = normalizeLLMMotion(rawMotion)
    const type = normalizeLLMSlideTypeForContent(normalizeLLMSlideType(rawType, index), {
      comparison,
      points,
      slide,
    }, index)

    return {
      ...rest,
      ...(comparison === undefined ? {} : {comparison}),
      ...(motion === undefined ? {} : {motion}),
      points,
      speakerNote,
      ...(subtitle === '' ? {} : {subtitle}),
      title,
      type,
    }
  }).filter((slide) => slide.title !== '' && slide.speakerNote !== '')

  const repairedSlides = diversifyRepeatedDeckTemplates(repairLLMTextDeckSlides(slides))

  return repairedSlides.length === 0
    ? [{
        motion: 'cinematic-rise',
        points: [],
        speakerNote: cleanGeneratedText(plan.summary, plan.title),
        title: cleanGeneratedText(plan.title, 'Deck Explainer'),
        type: 'hero',
      }]
    : repairedSlides
}

function repairLLMTextDeckSlides(slides: NormalizedLLMTextDeckSlide[]): NormalizedLLMTextDeckSlide[] {
  return slides.flatMap((slide) => repairLLMTextDeckSlide(slide))
}

function diversifyRepeatedDeckTemplates(slides: NormalizedLLMTextDeckSlide[]): NormalizedLLMTextDeckSlide[] {
  let repeatedThreePointCount = 0

  return slides.map((slide, index) => {
    if (index === 0 || slide.type !== 'three-points' || slide.points.length < 2) {
      repeatedThreePointCount = slide.type === 'three-points' ? 1 : 0
      return slide
    }

    repeatedThreePointCount += 1

    if (repeatedThreePointCount < 2) {
      return slide
    }

    return {
      ...slide,
      type: alternateRepeatedPointTemplate(slide, repeatedThreePointCount),
    }
  })
}

function alternateRepeatedPointTemplate(slide: NormalizedLLMTextDeckSlide, repeatedCount: number): DeckSlideType {
  const title = slide.title

  if (/验证|时间|季度|路径|链/u.test(title)) {
    return 'timeline'
  }

  if (/评分|质量|总结|标准|仓位/u.test(title)) {
    return 'summary'
  }

  return repeatedCount % 2 === 0 ? 'process' : 'timeline'
}

function repairLLMTextDeckSlide(slide: NormalizedLLMTextDeckSlide): NormalizedLLMTextDeckSlide[] {
  if (slide.type === 'comparison' && slide.comparison !== undefined) {
    return [{
      ...slide,
      comparison: {
        left: {
          ...slide.comparison.left,
          points: slide.comparison.left.points.slice(0, findDeckTemplateManifestEntry('comparison').limits.left_points),
        },
        right: {
          ...slide.comparison.right,
          points: slide.comparison.right.points.slice(0, findDeckTemplateManifestEntry('comparison').limits.right_points),
        },
      },
    }]
  }

  const maxPoints = maxPointsForDeckTemplate(slide.type)

  if (maxPoints === undefined || slide.points.length <= maxPoints) {
    return [slide]
  }

  if (findDeckTemplateManifestEntry(slide.type).repair !== 'split-points') {
    return [{
      ...slide,
      points: slide.points.slice(0, maxPoints),
    }]
  }

  const chunks = chunk(slide.points, maxPoints)

  return chunks.map((points, index) => ({
    ...slide,
    points,
    title: index === 0 ? slide.title : `${slide.title}（续）`,
    type: index === 0 ? slide.type : continuationTemplateType(slide.type),
  }))
}

function continuationTemplateType(type: DeckSlideType): DeckSlideType {
  if (type === 'hero' || type === 'stat' || type === 'chart') {
    return 'three-points'
  }

  return type
}

function normalizeLLMComparison(comparison: LLMTextDeckSlide['comparison']): NormalizedLLMTextDeckSlide['comparison'] {
  if (comparison === undefined) {
    return undefined
  }

  const leftLabel = cleanGeneratedText(comparison.left.label, '')
  const rightLabel = cleanGeneratedText(comparison.right.label, '')
  const leftPoints = cleanGeneratedPoints(comparison.left.points, 3)
  const rightPoints = cleanGeneratedPoints(comparison.right.points, 3)

  if (leftLabel === '' || rightLabel === '' || leftPoints.length === 0 || rightPoints.length === 0) {
    return undefined
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

function cleanGeneratedPoints(points: string[], limit: number): string[] {
  return points
    .map((point) => cleanGeneratedText(point, ''))
    .filter((point) => point !== '')
    .slice(0, limit)
}

function normalizeLLMSlideType(type: string | undefined, index: number): DeckSlideType {
  return isDeckTemplateType(type) ? type : index === 0 ? 'hero' : 'three-points'
}

function normalizeLLMSlideTypeForContent(
  type: DeckSlideType,
  input: {
    comparison: NormalizedLLMTextDeckSlide['comparison']
    points: string[]
    slide: LLMTextDeckSlide
  },
  index: number,
): DeckSlideType {
  if (index === 0) {
    return 'hero'
  }

  if (type === 'comparison' && input.comparison === undefined) {
    return input.points.length >= 2 ? 'three-points' : 'one-big-idea'
  }

  if (type === 'stat' && input.slide.stat === undefined) {
    return input.points.length >= 2 ? 'three-points' : 'one-big-idea'
  }

  if (type === 'quote' && input.slide.quote === undefined) {
    return 'one-big-idea'
  }

  if (type === 'code' && input.slide.code === undefined) {
    return input.points.length >= 2 ? 'three-points' : 'one-big-idea'
  }

  if ((type === 'chart' || type === 'process' || type === 'timeline' || type === 'summary' || type === 'three-points') && input.points.length === 0) {
    return 'one-big-idea'
  }

  return type
}

function normalizeLLMMotion(motion: string | undefined): Slide['motion'] | undefined {
  return isLLMDeckMotionPreset(motion) ? motion : undefined
}

function isLLMDeckMotionPreset(value: unknown): value is Slide['motion'] {
  return typeof value === 'string' && (LLM_DECK_MOTION_PRESETS as readonly string[]).includes(value)
}
