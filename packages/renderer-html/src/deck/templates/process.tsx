import {ProcessList, TitleBlock} from '../components/index.js'
import {defineSlideTemplate} from './define-template.js'

export const processTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <ProcessList points={slide.points} />
    </>
  ),
  type: 'process',
})
