import type {DeckMotionPreset, DeckSlideType, Slide} from '@video-agent/ir'
import type {ReactNode} from 'react'

export interface DeckTemplateQualityRules {
  maxPointLines?: number
  maxPoints?: number
  minPoints?: number
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
  type: DeckSlideType
  useWhen: string
}

export interface SlideTemplate {
  render: (slide: Slide) => ReactNode
  type: DeckSlideType
}

export interface TemplateMotionStep {
  selector: string
  preset: DeckMotionPreset | ((slideMotion: DeckMotionPreset) => DeckMotionPreset)
  at: (slideDuration: number) => number
  duration: (slideDuration: number) => number
  stagger?: number
}

export interface SlideTemplateModule {
  manifest: DeckTemplateManifestEntry
  motionSteps?: TemplateMotionStep[]
  styles?: string
  template: SlideTemplate
}

export function defineSlideTemplate(template: SlideTemplate): SlideTemplate {
  return template
}

export function defineSlideTemplateModule(module: SlideTemplateModule): SlideTemplateModule {
  if (module.template.type !== module.manifest.type) {
    throw new Error(`Slide template type "${module.template.type}" does not match manifest type "${module.manifest.type}".`)
  }

  return module
}
