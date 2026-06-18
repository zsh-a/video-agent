import {BulletList, TitleBlock} from '../components/index.js'
import {defineSlideTemplate} from './define-template.js'

export const heroTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <BulletList className="hero__points" max={2} points={slide.points} />
    </>
  ),
  type: 'hero',
})
