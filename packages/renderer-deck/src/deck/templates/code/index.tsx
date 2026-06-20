import {CodeBlock, TitleBlock} from '../../components/index.js'
import {titlePresetFor} from '../../motion/index.js'
import {slideTiming} from '../../motion/helpers.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {codeManifest} from './manifest.js'
import {codeStyles} from './styles.js'

const codeMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: (m) => titlePresetFor(m), at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.code-block', preset: 'blur-rise', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).titleDuration(d)},
]

export const codeTemplate = defineSlideTemplate({
  render: (slide) => {
    if (slide.code === undefined) {
      throw new Error(`Deck code slide "${slide.slideId}" is missing code block.`)
    }

    return (
      <>
        <TitleBlock slide={slide} />
        <CodeBlock code={slide.code} />
      </>
    )
  },
  type: 'code',
})

export const codeTemplateModule = defineSlideTemplateModule({
  manifest: codeManifest,
  motionSteps: codeMotionSteps,
  styles: codeStyles,
  template: codeTemplate,
})
