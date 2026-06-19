import {BulletList, TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule} from '../define-template.js'
import {threePointsManifest} from './manifest.js'
import {threePointsStyles} from './styles.js'

export const threePointsTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <BulletList className="points" max={3} points={slide.points} />
    </>
  ),
  type: 'three-points',
})

export const threePointsTemplateModule = defineSlideTemplateModule({
  manifest: threePointsManifest,
  styles: threePointsStyles,
  template: threePointsTemplate,
})
