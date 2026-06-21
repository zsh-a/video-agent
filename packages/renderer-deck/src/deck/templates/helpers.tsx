import type {DeckComparison, DeckProcess, Slide} from '@video-agent/ir'

export function comparisonForSlide(slide: Slide): DeckComparison | undefined {
  if (
    slide.comparison !== undefined &&
    slide.comparison.left.points.length > 0 &&
    slide.comparison.right.points.length > 0
  ) {
    return slide.comparison
  }

  return undefined
}

export function requireComparisonForSlide(slide: Slide): DeckComparison {
  const comparison = comparisonForSlide(slide)

  if (comparison === undefined) {
    throw new Error(`Deck comparison slide "${slide.slideId}" is missing complete comparison content.`)
  }

  return comparison
}

export function requireSlidePoints(slide: Slide, template: string): string[] {
  if (slide.points.length === 0) {
    throw new Error(`Deck ${template} slide "${slide.slideId}" is missing visible points.`)
  }

  return slide.points
}

export function requireSlideProcess(slide: Slide, template: string): DeckProcess {
  if (slide.process === undefined || slide.process.steps.length === 0) {
    throw new Error(`Deck ${template} slide "${slide.slideId}" is missing visible process steps.`)
  }

  return slide.process
}
