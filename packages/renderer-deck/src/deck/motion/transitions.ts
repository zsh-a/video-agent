import type {DeckTransitionType, TimedDeck} from '@video-agent/ir'

import type {DeckMotionSlide} from './index.js'

export interface DeckMotionTransition {
  from: string
  to: string
  type: DeckTransitionType
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

    if (from.transitionOut === undefined) {
      throw new Error(`Deck slide "${from.slideId}" is missing LLM-authored transitionOut for slide "${to.slideId}"; no template-type transition fallback is allowed.`)
    }

    transitions.push({
      duration: from.transitionOut.duration,
      from: from.slideId,
      to: to.slideId,
      type: from.transitionOut.type,
    })
  }

  return transitions
}
