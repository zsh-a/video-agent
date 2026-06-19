import {CtaBlock, TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule} from '../define-template.js'
import {ctaManifest} from './manifest.js'
import {ctaStyles} from './styles.js'

export const ctaTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <CtaBlock slide={slide} />
    </>
  ),
  type: 'cta',
})

export const ctaTemplateModule = defineSlideTemplateModule({
  manifest: ctaManifest,
  styles: ctaStyles,
  template: ctaTemplate,
})
