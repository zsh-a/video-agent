import {BulletList, TitleBlock} from '../components/index.js'
import {defineSlideTemplate} from './define-template.js'

export const summaryTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <BulletList className="summary__points" max={4} points={slide.points} />
    </>
  ),
  type: 'summary',
})
