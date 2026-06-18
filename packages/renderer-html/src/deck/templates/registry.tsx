import type {DeckSlideType} from '@video-agent/ir'

import {chartTemplate} from './chart.js'
import {codeTemplate} from './code.js'
import {comparisonTemplate} from './comparison.js'
import {ctaTemplate} from './cta.js'
import type {SlideTemplate} from './define-template.js'
import {heroTemplate} from './hero.js'
import {oneBigIdeaTemplate} from './one-big-idea.js'
import {processTemplate} from './process.js'
import {quoteTemplate} from './quote.js'
import {sectionTemplate} from './section.js'
import {statTemplate} from './stat.js'
import {summaryTemplate} from './summary.js'
import {threePointsTemplate} from './three-points.js'
import {timelineTemplate} from './timeline.js'

export const slideTemplates = [
  heroTemplate,
  sectionTemplate,
  oneBigIdeaTemplate,
  threePointsTemplate,
  comparisonTemplate,
  processTemplate,
  timelineTemplate,
  quoteTemplate,
  statTemplate,
  chartTemplate,
  codeTemplate,
  summaryTemplate,
  ctaTemplate,
] satisfies SlideTemplate[]

export const slideTemplateRegistry = new Map<DeckSlideType, SlideTemplate>(
  slideTemplates.map((template) => [template.type, template]),
)

export function resolveSlideTemplate(type: DeckSlideType): SlideTemplate {
  return slideTemplateRegistry.get(type) ?? threePointsTemplate
}
