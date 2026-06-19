import {BulletList, TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule} from '../define-template.js'
import {heroManifest} from './manifest.js'
import {heroStyles} from './styles.js'

export const heroTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <BulletList className="hero__points" max={2} points={slide.points} />
    </>
  ),
  type: 'hero',
})

export const heroTemplateModule = defineSlideTemplateModule({
  manifest: heroManifest,
  styles: heroStyles,
  template: heroTemplate,
})
