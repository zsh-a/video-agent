import type {DeckMotionPreset, DeckSlideType, Slide} from '@video-agent/ir'

export interface DeckTemplateQualityRules {
  maxPointLines?: number
  maxPoints?: number
  maxTitleLines?: number
  requiredVisibleElements: string[]
  safeArea: boolean
}

export interface DeckTemplateManifestEntry {
  description: string
  fields: string[]
  limits: Record<string, number>
  motionPresets: DeckMotionPreset[]
  qualityRules: DeckTemplateQualityRules
  repair: 'split-points' | 'fallback-readable' | 'none'
  type: DeckSlideType
  useWhen: string
}

export interface DeckTemplateManifestForLLMEntry {
  fields: string[]
  limits: Record<string, number>
  motion_presets: DeckMotionPreset[]
  quality_rules: DeckTemplateQualityRules
  repair: DeckTemplateManifestEntry['repair']
  type: DeckSlideType
  use_when: string
}

export interface DeckTemplateManifestForLLM {
  templates: DeckTemplateManifestForLLMEntry[]
}

export const deckTemplateManifest = [
  {
    description: 'Opening or chapter title slide with a strong visual hierarchy.',
    fields: ['title', 'subtitle', 'points'],
    limits: {
      points: 2,
      point_chars: 28,
      subtitle_chars: 42,
      title_chars: 24,
    },
    motionPresets: ['cinematic-rise', 'blur-rise', 'fade-in'],
    qualityRules: {
      maxPointLines: 2,
      maxPoints: 2,
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title'],
      safeArea: true,
    },
    repair: 'split-points',
    type: 'hero',
    useWhen: 'Opening title, chapter title, or strong point introduction.',
  },
  {
    description: 'Section divider for a new topic or chapter.',
    fields: ['title', 'subtitle'],
    limits: {
      subtitle_chars: 42,
      title_chars: 24,
    },
    motionPresets: ['wipe', 'fade-in'],
    qualityRules: {
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title', '.section__rule'],
      safeArea: true,
    },
    repair: 'fallback-readable',
    type: 'section',
    useWhen: 'Separating chapters, major topics, or narrative beats.',
  },
  {
    description: 'Single insight slide with one primary statement and optional supporting context.',
    fields: ['title', 'subtitle', 'points'],
    limits: {
      points: 3,
      point_chars: 36,
      title_chars: 28,
    },
    motionPresets: ['progressive-reveal', 'blur-rise', 'soft-scale'],
    qualityRules: {
      maxPointLines: 2,
      maxPoints: 3,
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title', '.idea-card'],
      safeArea: true,
    },
    repair: 'split-points',
    type: 'one-big-idea',
    useWhen: 'Explaining one key idea, claim, or takeaway without parallel structure.',
  },
  {
    description: 'Three parallel points under one topic.',
    fields: ['title', 'points'],
    limits: {
      point_chars: 28,
      points: 3,
      title_chars: 28,
    },
    motionPresets: ['progressive-reveal', 'stagger-up', 'blur-rise'],
    qualityRules: {
      maxPointLines: 2,
      maxPoints: 3,
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title', '.point'],
      safeArea: true,
    },
    repair: 'split-points',
    type: 'three-points',
    useWhen: 'Explaining three parallel principles, reasons, criteria, or steps.',
  },
  {
    description: 'Two-sided comparison with balanced labels and concise point lists.',
    fields: ['title', 'comparison.left.label', 'comparison.left.points', 'comparison.right.label', 'comparison.right.points'],
    limits: {
      left_points: 3,
      point_chars: 30,
      right_points: 3,
      title_chars: 28,
    },
    motionPresets: ['card-stack', 'blur-rise', 'progressive-reveal'],
    qualityRules: {
      maxPointLines: 2,
      maxPoints: 6,
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title', '.comparison__side'],
      safeArea: true,
    },
    repair: 'fallback-readable',
    type: 'comparison',
    useWhen: 'Comparing two options, concepts, architectures, states, or tradeoffs.',
  },
  {
    description: 'Ordered process or pipeline slide.',
    fields: ['title', 'points'],
    limits: {
      point_chars: 28,
      steps: 5,
      title_chars: 28,
    },
    motionPresets: ['progressive-reveal', 'stagger-up', 'line-draw'],
    qualityRules: {
      maxPointLines: 2,
      maxPoints: 5,
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title', '.process-list .point'],
      safeArea: true,
    },
    repair: 'split-points',
    type: 'process',
    useWhen: 'Describing a workflow, pipeline, lifecycle, or ordered phase sequence.',
  },
  {
    description: 'Ordered sequence over time.',
    fields: ['title', 'points'],
    limits: {
      items: 5,
      point_chars: 28,
      title_chars: 28,
    },
    motionPresets: ['line-draw', 'progressive-reveal', 'stagger-up'],
    qualityRules: {
      maxPointLines: 2,
      maxPoints: 5,
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title', '.timeline__item'],
      safeArea: true,
    },
    repair: 'split-points',
    type: 'timeline',
    useWhen: 'Showing events, milestones, or state changes in chronological order.',
  },
  {
    description: 'Quote emphasis slide.',
    fields: ['title', 'quote.text', 'quote.attribution'],
    limits: {
      quote_chars: 96,
      title_chars: 24,
    },
    motionPresets: ['soft-scale', 'fade-in', 'blur-rise'],
    qualityRules: {
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title', '.quote-block'],
      safeArea: true,
    },
    repair: 'fallback-readable',
    type: 'quote',
    useWhen: 'Highlighting a source quote or memorable sentence.',
  },
  {
    description: 'Large number or metric slide.',
    fields: ['title', 'stat.value', 'stat.label', 'stat.caption', 'points'],
    limits: {
      point_chars: 28,
      points: 3,
      title_chars: 24,
    },
    motionPresets: ['number-count', 'spotlight', 'soft-scale'],
    qualityRules: {
      maxPointLines: 2,
      maxPoints: 3,
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title', '.stat-block'],
      safeArea: true,
    },
    repair: 'split-points',
    type: 'stat',
    useWhen: 'Emphasizing one meaningful metric with label and context.',
  },
  {
    description: 'Simple qualitative chart slide.',
    fields: ['title', 'points'],
    limits: {
      bars: 4,
      point_chars: 28,
      title_chars: 28,
    },
    motionPresets: ['line-draw', 'stagger-up', 'progressive-reveal'],
    qualityRules: {
      maxPointLines: 1,
      maxPoints: 4,
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title', '.chart-bar'],
      safeArea: true,
    },
    repair: 'split-points',
    type: 'chart',
    useWhen: 'Showing a small set of comparable qualitative indicators.',
  },
  {
    description: 'Code or structured text slide.',
    fields: ['title', 'code.language', 'code.text'],
    limits: {
      code_lines: 12,
      title_chars: 28,
    },
    motionPresets: ['blur-rise', 'progressive-reveal'],
    qualityRules: {
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title', '.code-block'],
      safeArea: true,
    },
    repair: 'fallback-readable',
    type: 'code',
    useWhen: 'Explaining short code, configuration, schema, or structured text.',
  },
  {
    description: 'Summary slide with final takeaways.',
    fields: ['title', 'points'],
    limits: {
      point_chars: 30,
      points: 4,
      title_chars: 28,
    },
    motionPresets: ['progressive-reveal', 'stagger-up', 'fade-in'],
    qualityRules: {
      maxPointLines: 2,
      maxPoints: 4,
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title', '.point'],
      safeArea: true,
    },
    repair: 'split-points',
    type: 'summary',
    useWhen: 'Summarizing takeaways, conclusions, or final recommendations.',
  },
  {
    description: 'Final call-to-action slide.',
    fields: ['title', 'subtitle', 'points'],
    limits: {
      points: 1,
      subtitle_chars: 42,
      title_chars: 24,
    },
    motionPresets: ['zoom-focus', 'soft-scale', 'fade-in'],
    qualityRules: {
      maxPointLines: 2,
      maxPoints: 1,
      maxTitleLines: 2,
      requiredVisibleElements: ['.slide__title', '.cta-block'],
      safeArea: true,
    },
    repair: 'fallback-readable',
    type: 'cta',
    useWhen: 'Ending the deck with one next step or closing message.',
  },
] as const satisfies readonly DeckTemplateManifestEntry[]

export const deckTemplateManifestForLLM: DeckTemplateManifestForLLM = {
  templates: deckTemplateManifest.map((template) => ({
    fields: [...template.fields],
    limits: template.limits,
    motion_presets: [...template.motionPresets],
    quality_rules: template.qualityRules,
    repair: template.repair,
    type: template.type,
    use_when: template.useWhen,
  })),
}

export const deckTemplateTypes = deckTemplateManifest.map((template) => template.type)

export function isDeckTemplateType(value: unknown): value is DeckSlideType {
  return typeof value === 'string' && (deckTemplateTypes as readonly string[]).includes(value)
}

export function findDeckTemplateManifestEntry(type: DeckSlideType): DeckTemplateManifestEntry {
  return deckTemplateManifest.find((template) => template.type === type) ?? deckTemplateManifest[0]
}

export function maxPointsForDeckTemplate(type: DeckSlideType): number | undefined {
  const limits = findDeckTemplateManifestEntry(type).limits

  return limits.points ?? limits.steps ?? limits.items ?? limits.bars
}

export function validateSlideAgainstTemplateManifest(slide: Slide): string[] {
  const template = findDeckTemplateManifestEntry(slide.type)
  const issues: string[] = []
  const maxPoints = maxPointsForDeckTemplate(slide.type)

  if (maxPoints !== undefined && slide.points.length > maxPoints) {
    issues.push(`Slide ${slide.slideId} exceeds ${slide.type} point limit ${maxPoints}.`)
  }

  const titleLimit = template.limits.title_chars

  if (titleLimit !== undefined && slide.title.length > titleLimit) {
    issues.push(`Slide ${slide.slideId} title exceeds ${slide.type} title limit ${titleLimit}.`)
  }

  return issues
}
