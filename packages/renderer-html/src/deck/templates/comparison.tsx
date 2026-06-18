import {ComparisonBlock, TitleBlock} from '../components/index.js'
import {defineSlideTemplate} from './define-template.js'
import {ReadableFallback, comparisonForSlide} from './helpers.js'

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
