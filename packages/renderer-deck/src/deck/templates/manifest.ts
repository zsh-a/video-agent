import type {DeckSlideType, Slide} from '@video-agent/ir'

import type {DeckTemplateManifestEntry, DeckTemplateQualityRules} from './define-template.js'
import {slideTemplateManifests} from './registry.js'

export type {DeckTemplateManifestEntry, DeckTemplateQualityRules} from './define-template.js'

export interface DeckTemplateManifestForLLMEntry {
  fields: string[]
  limits: Record<string, number>
  motion_presets: DeckTemplateManifestEntry['motionPresets']
  quality_rules: DeckTemplateQualityRules
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
    type: template.type,
    use_when: template.useWhen,
  })),
}

export const deckTemplateTypes = deckTemplateManifest.map((template) => template.type)

export function isDeckTemplateType(value: unknown): value is DeckSlideType {
  return typeof value === 'string' && (deckTemplateTypes as readonly string[]).includes(value)
}

export function findDeckTemplateManifestEntry(type: DeckSlideType): DeckTemplateManifestEntry {
  const template = deckTemplateManifest.find((entry) => entry.type === type)

  if (template === undefined) {
    throw new Error(`No Deck template manifest registered for slide type "${type}".`)
  }

  return template
}

export function maxPointsForDeckTemplate(type: DeckSlideType): number | undefined {
  const template = findDeckTemplateManifestEntry(type)
  const limits = template.limits

  return limits.points ?? limits.steps ?? limits.items ?? limits.bars ?? template.qualityRules.maxPoints
}

export function minPointsForDeckTemplate(type: DeckSlideType): number | undefined {
  return findDeckTemplateManifestEntry(type).qualityRules.minPoints
}

export function validateSlideAgainstTemplateManifest(slide: Slide): string[] {
  const template = findDeckTemplateManifestEntry(slide.type)

  return [
    ...validatePointCount(slide),
    ...validateTextLength(slide, 'title', slide.title, template.limits.title_chars, 'title limit'),
    ...validateTextLength(slide, 'subtitle', slide.subtitle, template.limits.subtitle_chars, 'subtitle limit'),
    ...validatePointCharacters(slide, template.limits.point_chars),
    ...validateChartBars(slide, template.limits),
    ...validateComparisonSideCounts(slide, template.limits),
    ...validateCodeLines(slide, template.limits.code_lines),
    ...validateTextLength(slide, 'quote', slide.quote?.text, template.limits.quote_chars, 'quote limit'),
  ]
}

function validatePointCount(slide: Slide): string[] {
  const maxPoints = maxPointsForDeckTemplate(slide.type)
  const minPoints = minPointsForDeckTemplate(slide.type)

  return [
    ...(maxPoints !== undefined && slide.points.length > maxPoints
      ? [`Slide ${slide.slideId} exceeds ${slide.type} point limit ${maxPoints}.`]
      : []),
    ...(minPoints !== undefined && slide.points.length < minPoints
      ? [`Slide ${slide.slideId} requires at least ${minPoints} ${slide.type} point.`]
      : []),
  ]
}

function validateTextLength(slide: Slide, field: string, value: string | undefined, limit: number | undefined, label: string): string[] {
  return limit !== undefined && (value?.length ?? 0) > limit
    ? [`Slide ${slide.slideId} ${field} exceeds ${slide.type} ${label} ${limit}.`]
    : []
}

function validatePointCharacters(slide: Slide, limit: number | undefined): string[] {
  if (limit === undefined) {
    return []
  }

  return [
    ...textLimitIssues(slide, slide.points, limit, 'point'),
    ...textLimitIssues(slide, slide.comparison?.left.points ?? [], limit, 'left comparison point'),
    ...textLimitIssues(slide, slide.comparison?.right.points ?? [], limit, 'right comparison point'),
  ]
}

function validateChartBars(slide: Slide, limits: DeckTemplateManifestEntry['limits']): string[] {
  return [
    ...validateCountLimit(slide, 'chart bars', slide.chart?.bars.length ?? 0, limits.bars, 'bars'),
    ...(limits.point_chars === undefined ? [] : textLimitIssues(slide, slide.chart?.bars.map((bar) => bar.label) ?? [], limits.point_chars, 'chart bar label')),
  ]
}

function textLimitIssues(slide: Slide, values: string[], limit: number, label: string): string[] {
  return values
    .filter((value) => value.length > limit)
    .map(() => `Slide ${slide.slideId} ${label} exceeds ${slide.type} point character limit ${limit}.`)
}

function validateComparisonSideCounts(slide: Slide, limits: DeckTemplateManifestEntry['limits']): string[] {
  return [
    ...validateCountLimit(slide, 'left comparison points', slide.comparison?.left.points.length ?? 0, limits.left_points, 'left_points'),
    ...validateCountLimit(slide, 'right comparison points', slide.comparison?.right.points.length ?? 0, limits.right_points, 'right_points'),
  ]
}

function validateCountLimit(slide: Slide, field: string, count: number, limit: number | undefined, label: string): string[] {
  return limit !== undefined && count > limit
    ? [`Slide ${slide.slideId} ${field} exceed ${slide.type} ${label} limit ${limit}.`]
    : []
}

function validateCodeLines(slide: Slide, limit: number | undefined): string[] {
  return limit !== undefined && lineCount(slide.code?.text) > limit
    ? [`Slide ${slide.slideId} code exceeds ${slide.type} code line limit ${limit}.`]
    : []
}

function lineCount(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return 0
  }

  return value.replaceAll(/\r\n?/g, '\n').split('\n').length
}
