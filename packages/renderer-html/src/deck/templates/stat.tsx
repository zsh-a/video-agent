import type {Slide} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {PointCard, StatNumber, TitleBlock} from '../components/index.js'
import {defineSlideTemplate} from './define-template.js'
import {ReadableFallback} from './helpers.js'

export const statTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <StatBody slide={slide} />
    </>
  ),
  type: 'stat',
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
