import {QuoteBlock, TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule} from '../define-template.js'
import {quoteForSlide} from '../helpers.js'
import {quoteManifest} from './manifest.js'
import {quoteStyles} from './styles.js'

export const quoteTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <QuoteBlock quote={quoteForSlide(slide)} />
    </>
  ),
  type: 'quote',
})

export const quoteTemplateModule = defineSlideTemplateModule({
  manifest: quoteManifest,
  styles: quoteStyles,
  template: quoteTemplate,
})
