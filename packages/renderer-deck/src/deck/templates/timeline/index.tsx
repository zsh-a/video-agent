import {Timeline, TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule} from '../define-template.js'
import {timelineManifest} from './manifest.js'
import {timelineStyles} from './styles.js'

export const timelineTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <Timeline points={slide.points} />
    </>
  ),
  type: 'timeline',
})

export const timelineTemplateModule = defineSlideTemplateModule({
  manifest: timelineManifest,
  styles: timelineStyles,
  template: timelineTemplate,
})
