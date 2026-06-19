import type {Slide} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {PointCard, StatNumber, TitleBlock} from '../../components/index.js'
import {slideTiming} from '../../motion-helpers.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {ReadableFallback} from '../helpers.js'
import {statManifest} from './manifest.js'
import {statStyles} from './styles.js'

const statMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: 'fade-in', at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).contentDuration(d)},
  {selector: '.stat-block', preset: 'number-count', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.stat-block strong', preset: 'spotlight', at: (d) => d * slideTiming(d).emphasisAt, duration: () => 0.55},
]

export const statTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <StatBody slide={slide} />
    </>
  ),
  type: 'stat',
})

export const statTemplateModule = defineSlideTemplateModule({
  manifest: statManifest,
  motionSteps: statMotionSteps,
  styles: statStyles,
  template: statTemplate,
})

function StatBody({slide}: {slide: Slide}): ReactNode {
  if (slide.stat === undefined) {
    return <ReadableFallback slide={slide} />
  }

  const points = slide.points.slice(0, 4)

  if (points.length === 0) {
    return <StatNumber stat={slide.stat} />
  }

  return (
    <div className="stat-layout">
      <StatNumber stat={slide.stat} />
      <div className="stat-points grid gap-[16px]">
        {points.map((point, index) => <PointCard index={index} key={`${point}-${index}`} point={point} />)}
      </div>
    </div>
  )
}
