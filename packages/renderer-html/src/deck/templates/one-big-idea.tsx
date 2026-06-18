import {IdeaCard, TitleBlock} from '../components/index.js'
import {defineSlideTemplate} from './define-template.js'

export const oneBigIdeaTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <IdeaCard slide={slide} />
    </>
  ),
  type: 'one-big-idea',
})
