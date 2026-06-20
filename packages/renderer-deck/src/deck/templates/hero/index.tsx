import type {ReactNode} from 'react'

import {TitleBlock} from '../../components/index.js'
import {classNames} from '../../layout/primitives.js'
import {titlePresetFor} from '../../motion/index.js'
import {slideTiming} from '../../motion/helpers.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {heroManifest} from './manifest.js'
import {heroStyles} from './styles.js'

const heroMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: (m) => m === 'progressive-reveal' ? 'cinematic-rise' : titlePresetFor(m), at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.slide__subtitle', preset: 'blur-rise', at: (d) => d * (slideTiming(d).enterAt + 0.08), duration: (d) => slideTiming(d).contentDuration(d)},
  {selector: '.hero__tagline', preset: 'stagger-up', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).contentDuration(d), stagger: 0.16},
]

export const heroTemplate = defineSlideTemplate({
  render: (slide) => (
    <>
      <TitleBlock slide={slide} />
      <HeroTaglines points={slide.points} />
      <div className="hero__glow" aria-hidden="true" />
    </>
  ),
  type: 'hero',
})

function HeroTaglines({points}: {points: string[]}): ReactNode {
  if (points.length > 2) {
    throw new Error(`Deck hero slide received ${points.length} taglines, exceeding renderer limit 2.`)
  }

  const items = points

  if (items.length === 0) {
    return null
  }

  return (
    <div className={classNames('hero__taglines', items.length === 1 ? 'hero__taglines--single' : '')}>
      {items.map((point, index) => (
        <span className="hero__tagline" key={`${point}-${index}`}>{point}</span>
      ))}
    </div>
  )
}

export const heroTemplateModule = defineSlideTemplateModule({
  manifest: heroManifest,
  motionSteps: heroMotionSteps,
  styles: heroStyles,
  template: heroTemplate,
})
