import type {DeckSlideType, Slide} from '@video-agent/ir'

import type {DeckTemplateManifestEntry, DeckTemplateQualityRules} from './define-template.js'
import {slideTemplateManifests} from './registry.js'

export type {DeckTemplateManifestEntry, DeckTemplateQualityRules} from './define-template.js'

export interface DeckTemplateManifestForLLMEntry {
  fields: string[]
  limits: Record<string, number>
  motion_presets: DeckTemplateManifestEntry['motionPresets']
  quality_rules: DeckTemplateQualityRules
  repair: DeckTemplateManifestEntry['repair']
  type: DeckSlideType
  use_when: string
}

export interface DeckTemplateManifestForLLM {
  templates: DeckTemplateManifestForLLMEntry[]
}

export const deckTemplateManifest = slideTemplateManifests

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
