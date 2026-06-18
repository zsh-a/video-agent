import type {DeckSlideType, Slide} from '@video-agent/ir'
import type {ReactNode} from 'react'

export interface SlideTemplate {
  render: (slide: Slide) => ReactNode
  type: DeckSlideType
}

export function defineSlideTemplate(template: SlideTemplate): SlideTemplate {
  return template
}
