import {BulletList, TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule} from '../define-template.js'
import {summaryManifest} from './manifest.js'
import {summaryStyles} from './styles.js'

export const summaryTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <BulletList className="summary__points" max={4} points={slide.points} />
    </>
  ),
  type: 'summary',
})

export const summaryTemplateModule = defineSlideTemplateModule({
  manifest: summaryManifest,
  styles: summaryStyles,
  template: summaryTemplate,
})
