import {CtaBlock, TitleBlock} from '../../components/index.js'
import {slideTiming} from '../../motion/helpers.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {ctaManifest} from './manifest.js'
import {ctaStyles} from './styles.js'

const ctaMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: 'zoom-focus', at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.cta-block', preset: 'soft-scale', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).titleDuration(d)},
]

export const ctaTemplate = defineSlideTemplate({
  render: (slide) => {
    if (slide.points[0] === undefined) {
      throw new Error(`Deck cta slide "${slide.slideId}" is missing an LLM-authored action point.`)
    }

    return (
      <>
        <TitleBlock slide={slide} />
        <CtaBlock slide={slide} />
      </>
    )
  },
  type: 'cta',
})

export const ctaTemplateModule = defineSlideTemplateModule({
  manifest: ctaManifest,
  motionSteps: ctaMotionSteps,
  styles: ctaStyles,
  template: ctaTemplate,
})
