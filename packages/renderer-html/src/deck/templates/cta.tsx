import {CtaBlock, TitleBlock} from '../components/index.js'
import {defineSlideTemplate} from './define-template.js'

export const ctaTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <CtaBlock slide={slide} />
    </>
  ),
  type: 'cta',
})
