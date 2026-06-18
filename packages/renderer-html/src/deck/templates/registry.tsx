import type {DeckSlideType} from '@video-agent/ir'

import type {DeckTemplateManifestEntry, SlideTemplate, SlideTemplateModule} from './define-template.js'
import {chartTemplateModule} from './chart/index.js'
import {codeTemplateModule} from './code/index.js'
import {comparisonTemplateModule} from './comparison/index.js'
import {ctaTemplateModule} from './cta/index.js'
import {heroTemplateModule} from './hero/index.js'
import {oneBigIdeaTemplateModule} from './one-big-idea/index.js'
import {processTemplateModule} from './process/index.js'
import {quoteTemplateModule} from './quote/index.js'
import {sectionTemplateModule} from './section/index.js'
import {statTemplateModule} from './stat/index.js'
import {summaryTemplateModule} from './summary/index.js'
import {threePointsTemplateModule} from './three-points/index.js'
import {timelineTemplateModule} from './timeline/index.js'

export const slideTemplateModules = [
  heroTemplateModule,
  sectionTemplateModule,
  oneBigIdeaTemplateModule,
  threePointsTemplateModule,
  comparisonTemplateModule,
  processTemplateModule,
  timelineTemplateModule,
  quoteTemplateModule,
  statTemplateModule,
  chartTemplateModule,
  codeTemplateModule,
  summaryTemplateModule,
  ctaTemplateModule,
] satisfies SlideTemplateModule[]

export const slideTemplates = slideTemplateModules.map((module) => module.template) satisfies SlideTemplate[]

export const slideTemplateManifests = slideTemplateModules.map((module) => module.manifest) satisfies DeckTemplateManifestEntry[]

export const slideTemplateStyles = slideTemplateModules.map((module) => module.styles).filter((styles) => styles.length > 0)

export const slideTemplateRegistry = new Map<DeckSlideType, SlideTemplate>(
  slideTemplates.map((template) => [template.type, template]),
)

export function resolveSlideTemplate(type: DeckSlideType): SlideTemplate {
  return slideTemplateRegistry.get(type) ?? threePointsTemplateModule.template
}
