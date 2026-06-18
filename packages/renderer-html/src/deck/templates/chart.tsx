import {ChartBlock, TitleBlock} from '../components/index.js'
import {defineSlideTemplate} from './define-template.js'

export const chartTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <ChartBlock points={slide.points} />
    </>
  ),
  type: 'chart',
})
