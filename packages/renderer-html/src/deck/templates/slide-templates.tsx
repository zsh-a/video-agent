import type {Slide} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {resolveSlideTemplate} from './registry.js'

export function SlideBody({slide}: {slide: Slide}): ReactNode {
  return resolveSlideTemplate(slide.type).render(slide)
}
