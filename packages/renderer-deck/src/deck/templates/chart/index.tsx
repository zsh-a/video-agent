import {ChartBlock, TitleBlock} from '../../components/index.js'
import {titlePresetFor} from '../../motion/index.js'
import {slideTiming} from '../../motion/helpers.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {chartManifest} from './manifest.js'
import {chartStyles} from './styles.js'

const chartMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: (m) => titlePresetFor(m), at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.chart-bar', preset: 'stagger-up', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).contentDuration(d), stagger: 0.14},
  {selector: '.chart-bar i', preset: 'line-draw', at: (d) => d * (slideTiming(d).contentAt + 0.10), duration: (d) => slideTiming(d).contentDuration(d), stagger: 0.12},
]

export const chartTemplate = defineSlideTemplate({
  render: (slide) => {
    if (slide.chart === undefined) {
      throw new Error(`Deck chart slide "${slide.slideId}" is missing chart data.`)
    }

    return (
      <>
        <TitleBlock slide={slide} />
        <ChartBlock chart={slide.chart} />
      </>
    )
  },
  type: 'chart',
})

export const chartTemplateModule = defineSlideTemplateModule({
  manifest: chartManifest,
  motionSteps: chartMotionSteps,
  styles: chartStyles,
  template: chartTemplate,
})
