import type {TimedDeck} from '@video-agent/ir'

import type {DeckMotionSlide} from './motion.js'

export interface DeckMotionTransition {
  from: string
  to: string
  type: 'crossfade' | 'fade' | 'slide-left' | 'slide-up'
  duration: number
}

export function compileTransitions(slides: TimedDeck['deck']['slides'], motionSlides: DeckMotionSlide[]): DeckMotionTransition[] {
  const transitions: DeckMotionTransition[] = []

  for (let i = 0; i < slides.length - 1; i++) {
    const from = slides[i]
    const to = slides[i + 1]
    const fromSlide = motionSlides[i]
    const toSlide = motionSlides[i + 1]

    if (from === undefined || to === undefined || fromSlide === undefined || toSlide === undefined) {
      continue
    }

    transitions.push({
      duration: 0.55,
      from: from.slideId,
      to: to.slideId,
      type: transitionType(from.type, to.type),
    })
  }

  return transitions
}

function transitionType(fromType: string, toType: string): DeckMotionTransition['type'] {
  if (fromType === 'section' || fromType === 'hero') {
    return 'slide-up'
  }

  if (toType === 'comparison' || toType === 'process' || toType === 'timeline') {
    return 'slide-left'
  }

  if (toType === 'section' || toType === 'cta') {
    return 'fade'
  }

  if (fromType === 'cta') {
    return 'fade'
  }

  return 'crossfade'
}
