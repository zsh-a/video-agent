import {IdeaCard, TitleBlock} from '../../components/index.js'
import {titlePresetFor} from '../../motion/index.js'
import {slideTiming} from '../../motion/helpers.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {oneBigIdeaManifest} from './manifest.js'
import {oneBigIdeaStyles} from './styles.js'

const oneBigIdeaMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: (m) => titlePresetFor(m), at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.slide__subtitle', preset: 'fade-in', at: (d) => d * (slideTiming(d).enterAt + 0.08), duration: (d) => slideTiming(d).contentDuration(d)},
  {selector: '.idea-card, .point', preset: 'stagger-up', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).contentDuration(d), stagger: 0.16},
]

export const oneBigIdeaTemplate = defineSlideTemplate({
	  render: (slide) => {
	    if (slide.points[0] === undefined) {
	      throw new Error(`Deck one-big-idea slide "${slide.slideId}" is missing an LLM-authored idea point.`)
	    }

	    if (slide.points.length > 3) {
	      throw new Error(`Deck one-big-idea slide "${slide.slideId}" received ${slide.points.length} points, exceeding renderer limit 3.`)
	    }

	    return (
      <>
        <TitleBlock slide={slide} />
        <IdeaCard slide={slide} />
      </>
    )
  },
  type: 'one-big-idea',
})

export const oneBigIdeaTemplateModule = defineSlideTemplateModule({
  manifest: oneBigIdeaManifest,
  motionSteps: oneBigIdeaMotionSteps,
  styles: oneBigIdeaStyles,
  template: oneBigIdeaTemplate,
})
