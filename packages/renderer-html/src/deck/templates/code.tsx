import {CodeBlock, TitleBlock} from '../components/index.js'
import {defineSlideTemplate} from './define-template.js'
import {codeForSlide} from './helpers.js'

export const codeTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <CodeBlock code={codeForSlide(slide)} />
    </>
  ),
  type: 'code',
})
