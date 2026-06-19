import {ProcessList, TitleBlock} from '../../components/index.js'
import {titlePresetFor} from '../../motion.js'
import {slideTiming} from '../../motion-helpers.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {processManifest} from './manifest.js'
import {processStyles} from './styles.js'

const processMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: (m) => titlePresetFor(m), at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.process-list .point', preset: 'stagger-up', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).contentDuration(d), stagger: 0.14},
]

export const processTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <ProcessList points={slide.points} />
    </>
  ),
  type: 'process',
})

export const processTemplateModule = defineSlideTemplateModule({
  manifest: processManifest,
  motionSteps: processMotionSteps,
  styles: processStyles,
  template: processTemplate,
})
