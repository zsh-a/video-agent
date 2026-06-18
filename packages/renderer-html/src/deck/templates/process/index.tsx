import {ProcessList, TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule} from '../define-template.js'
import {processManifest} from './manifest.js'
import {processStyles} from './styles.js'

export const processTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <ProcessList points={slide.points} />
    </>
  ),
  type: 'process',
})

export const processTemplateModule = defineSlideTemplateModule({
  manifest: processManifest,
  styles: processStyles,
  template: processTemplate,
})
