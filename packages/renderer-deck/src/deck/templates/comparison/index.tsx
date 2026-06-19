import {ComparisonBlock, TitleBlock} from '../../components/index.js'
import {titlePresetFor} from '../../motion/index.js'
import {slideTiming} from '../../motion/helpers.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {ReadableFallback, comparisonForSlide} from '../helpers.js'
import {comparisonManifest} from './manifest.js'
import {comparisonStyles} from './styles.js'

const comparisonMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: (m) => titlePresetFor(m), at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.slide__subtitle', preset: 'fade-in', at: (d) => d * (slideTiming(d).enterAt + 0.08), duration: (d) => slideTiming(d).contentDuration(d)},
  {selector: '.comparison__side', preset: 'card-stack', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).contentDuration(d), stagger: 0.18},
]

export const comparisonTemplate = defineSlideTemplate({
  render: (slide) => {
    const comparison = comparisonForSlide(slide)

    return (
      <>
        <TitleBlock slide={slide} />
        {comparison === undefined ? <ReadableFallback slide={slide} /> : <ComparisonBlock comparison={comparison} />}
      </>
    )
  },
  type: 'comparison',
})

export const comparisonTemplateModule = defineSlideTemplateModule({
  manifest: comparisonManifest,
  motionSteps: comparisonMotionSteps,
  styles: comparisonStyles,
  template: comparisonTemplate,
})
