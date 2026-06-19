import {IdeaCard, TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule} from '../define-template.js'
import {oneBigIdeaManifest} from './manifest.js'
import {oneBigIdeaStyles} from './styles.js'

export const oneBigIdeaTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <IdeaCard slide={slide} />
    </>
  ),
  type: 'one-big-idea',
})

export const oneBigIdeaTemplateModule = defineSlideTemplateModule({
  manifest: oneBigIdeaManifest,
  styles: oneBigIdeaStyles,
  template: oneBigIdeaTemplate,
})
