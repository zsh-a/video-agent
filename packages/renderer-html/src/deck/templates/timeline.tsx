import {Timeline, TitleBlock} from '../components/index.js'
import {defineSlideTemplate} from './define-template.js'

export const timelineTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <Timeline points={slide.points} />
    </>
  ),
  type: 'timeline',
})
