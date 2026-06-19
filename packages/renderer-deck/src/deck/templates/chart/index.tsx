import {ChartBlock, TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule} from '../define-template.js'
import {chartManifest} from './manifest.js'
import {chartStyles} from './styles.js'

export const chartTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <ChartBlock points={slide.points} />
    </>
  ),
  type: 'chart',
})

export const chartTemplateModule = defineSlideTemplateModule({
  manifest: chartManifest,
  styles: chartStyles,
  template: chartTemplate,
})
