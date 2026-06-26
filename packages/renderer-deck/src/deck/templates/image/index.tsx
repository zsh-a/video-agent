import type {Slide} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {Card, classNames} from '../../layout/primitives.js'
import {titlePresetFor} from '../../motion/index.js'
import {slideTiming} from '../../motion/helpers.js'
import {TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {imageManifest} from './manifest.js'
import {imageStyles} from './styles.js'

const imageMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: (m) => titlePresetFor(m), at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.slide__subtitle', preset: 'fade-in', at: (d) => d * (slideTiming(d).enterAt + 0.08), duration: (d) => slideTiming(d).contentDuration(d)},
  {selector: '.image-frame', preset: 'blur-rise', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.image-caption', preset: 'fade-in', at: (d) => d * (slideTiming(d).contentAt + 0.12), duration: (d) => slideTiming(d).contentDuration(d)},
]

export const imageTemplate = defineSlideTemplate({
  render: (slide) => {
    if (slide.image === undefined) {
      throw new Error(`Deck image slide "${slide.slideId}" is missing image data.`)
    }

    return (
      <>
        <TitleBlock slide={slide} />
        <ImageBody slide={slide} />
      </>
    )
  },
  type: 'image',
})

function ImageBody({slide}: {slide: Slide}): ReactNode {
  const image = slide.image!

  return (
    <div className="image-layout grid gap-[20px]">
      <Card className="image-frame relative overflow-hidden rounded-deck-card border border-deck-line bg-deck-surface shadow-deck-card">
        <img
          alt={image.alt ?? slide.title}
          className="image-frame__img block h-auto max-h-[520px] w-full rounded-deck-card object-contain"
          src={image.src}
        />
        <div className="image-frame__overlay" aria-hidden="true" />
      </Card>
      {image.caption === undefined ? null : (
        <p className="image-caption m-0 text-center text-deck-caption leading-deck-body text-deck-muted">{image.caption}</p>
      )}
    </div>
  )
}

export const imageTemplateModule = defineSlideTemplateModule({
  manifest: imageManifest,
  motionSteps: imageMotionSteps,
  styles: imageStyles,
  template: imageTemplate,
})
