import {QuoteBlock, TitleBlock} from '../../components/index.js'
import {slideTiming} from '../../motion/helpers.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {quoteManifest} from './manifest.js'
import {quoteStyles} from './styles.js'

const quoteMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: 'fade-in', at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).contentDuration(d)},
  {selector: '.quote-block', preset: 'soft-scale', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).titleDuration(d)},
]

export const quoteTemplate = defineSlideTemplate({
  render: (slide) => {
    if (slide.quote === undefined) {
      throw new Error(`Deck quote slide "${slide.slideId}" is missing quote text.`)
    }

    return (
      <>
        <TitleBlock slide={slide} />
        <QuoteBlock quote={slide.quote} />
      </>
    )
  },
  type: 'quote',
})

export const quoteTemplateModule = defineSlideTemplateModule({
  manifest: quoteManifest,
  motionSteps: quoteMotionSteps,
  styles: quoteStyles,
  template: quoteTemplate,
})
