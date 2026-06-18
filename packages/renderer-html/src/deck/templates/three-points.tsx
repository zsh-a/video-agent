import {BulletList, TitleBlock} from '../components/index.js'
import {defineSlideTemplate} from './define-template.js'

export const threePointsTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <BulletList className="points" max={3} points={slide.points} />
    </>
  ),
  type: 'three-points',
})
