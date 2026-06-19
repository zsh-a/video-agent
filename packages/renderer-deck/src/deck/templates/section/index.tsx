import {TitleBlock} from '../../components/index.js'
import {slideTiming} from '../../motion-helpers.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {sectionManifest} from './manifest.js'
import {sectionStyles} from './styles.js'

const sectionMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: 'wipe', at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.slide__subtitle', preset: 'fade-in', at: (d) => d * (slideTiming(d).enterAt + 0.10), duration: (d) => slideTiming(d).contentDuration(d)},
  {selector: '.section__rule', preset: 'line-draw', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).contentDuration(d)},
]

export const sectionTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <div className="section__rule" />
      <div className="section__orb" aria-hidden="true" />
    </>
  ),
  type: 'section',
})

export const sectionTemplateModule = defineSlideTemplateModule({
  manifest: sectionManifest,
  motionSteps: sectionMotionSteps,
  styles: sectionStyles,
  template: sectionTemplate,
})
