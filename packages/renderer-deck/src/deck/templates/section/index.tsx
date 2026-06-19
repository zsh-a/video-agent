import {TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule} from '../define-template.js'
import {sectionManifest} from './manifest.js'
import {sectionStyles} from './styles.js'

export const sectionTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <div className="section__rule h-[5px] w-[min(620px,72%)] origin-left rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent-2),var(--accent-warm))]" />
    </>
  ),
  type: 'section',
})

export const sectionTemplateModule = defineSlideTemplateModule({
  manifest: sectionManifest,
  styles: sectionStyles,
  template: sectionTemplate,
})
