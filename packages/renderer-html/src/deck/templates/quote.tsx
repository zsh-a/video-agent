import {QuoteBlock, TitleBlock} from '../components/index.js'
import {defineSlideTemplate} from './define-template.js'
import {quoteForSlide} from './helpers.js'

export const quoteTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <QuoteBlock quote={quoteForSlide(slide)} />
    </>
  ),
  type: 'quote',
})
