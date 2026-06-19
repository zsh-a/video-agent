import {ComparisonBlock, TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule} from '../define-template.js'
import {ReadableFallback, comparisonForSlide} from '../helpers.js'
import {comparisonManifest} from './manifest.js'
import {comparisonStyles} from './styles.js'

export const comparisonTemplate = defineSlideTemplate({
  render: (slide) => {
    const comparison = comparisonForSlide(slide)

    return (
      <>
        <TitleBlock slide={slide} />
        {comparison === undefined ? <ReadableFallback slide={slide} /> : <ComparisonBlock comparison={comparison} />}
      </>
    )
  },
  type: 'comparison',
})

export const comparisonTemplateModule = defineSlideTemplateModule({
  manifest: comparisonManifest,
  styles: comparisonStyles,
  template: comparisonTemplate,
})
