import {CodeBlock, TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule} from '../define-template.js'
import {codeForSlide} from '../helpers.js'
import {codeManifest} from './manifest.js'
import {codeStyles} from './styles.js'

export const codeTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <CodeBlock code={codeForSlide(slide)} />
    </>
  ),
  type: 'code',
})

export const codeTemplateModule = defineSlideTemplateModule({
  manifest: codeManifest,
  styles: codeStyles,
  template: codeTemplate,
})
