import {Timeline, TitleBlock} from '../../components/index.js'
import {titlePresetFor} from '../../motion/index.js'
import {slideTiming} from '../../motion/helpers.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {timelineManifest} from './manifest.js'
import {timelineStyles} from './styles.js'

const timelineMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: (m) => titlePresetFor(m), at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.timeline__line', preset: 'line-draw', at: (d) => d * slideTiming(d).contentAt, duration: (d) => d * 0.5},
  {selector: '.timeline__item', preset: 'stagger-up', at: (d) => d * (slideTiming(d).contentAt + 0.06), duration: (d) => slideTiming(d).contentDuration(d), stagger: 0.16},
]

export const timelineTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <Timeline points={slide.points} />
    </>
  ),
  type: 'timeline',
})

export const timelineTemplateModule = defineSlideTemplateModule({
  manifest: timelineManifest,
  motionSteps: timelineMotionSteps,
  styles: timelineStyles,
  template: timelineTemplate,
})
