import {BulletList, TitleBlock} from '../../components/index.js'
import {titlePresetFor} from '../../motion/index.js'
import {slideTiming} from '../../motion/helpers.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {summaryManifest} from './manifest.js'
import {summaryStyles} from './styles.js'

const summaryMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: (m) => titlePresetFor(m), at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.slide__subtitle', preset: 'fade-in', at: (d) => d * (slideTiming(d).enterAt + 0.08), duration: (d) => slideTiming(d).contentDuration(d)},
  {selector: '.point', preset: 'stagger-up', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).contentDuration(d), stagger: 0.16},
]

export const summaryTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <BulletList className="summary__points" max={4} points={slide.points} />
    </>
  ),
  type: 'summary',
})

export const summaryTemplateModule = defineSlideTemplateModule({
  manifest: summaryManifest,
  motionSteps: summaryMotionSteps,
  styles: summaryStyles,
  template: summaryTemplate,
})
