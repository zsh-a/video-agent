import type {DeckMotionPreset, Slide, TimedDeck} from '@video-agent/ir'

export interface DeckMotionPlan {
  duration: number
  slides: DeckMotionSlide[]
  steps: DeckMotionStep[]
  version: 1
}

export interface DeckMotionSlide {
  end: number
  slideId: string
  start: number
}

export interface DeckMotionStep {
  at: number
  duration: number
  preset: DeckMotionPreset
  selector: string
  stagger?: number
}

export function compileDeckMotionPlan(timedDeck: TimedDeck): DeckMotionPlan {
  const timingBySlide = new Map(timedDeck.timings.map((timing) => [timing.slideId, timing]))
  const slides = timedDeck.deck.slides.map((slide, index) => {
    const timing = timingBySlide.get(slide.slideId)
    const start = timing?.start ?? index
    const end = timing?.end ?? start + (slide.duration ?? 1)

    return {
      end: round(end),
      slideId: slide.slideId,
      start: round(start),
    }
  })
  const steps = timedDeck.deck.slides.flatMap((slide, index) => {
    const timing = slides[index]

    return timing === undefined ? [] : compileSlideSteps(slide, timing)
  })

  return {
    duration: round(slides.at(-1)?.end ?? 0),
    slides,
    steps,
    version: 1,
  }
}

function compileSlideSteps(slide: Slide, timing: DeckMotionSlide): DeckMotionStep[] {
  const duration = Math.max(0.1, timing.end - timing.start)
  const root = `[data-slide="${cssEscape(slide.slideId)}"]`
  const titlePreset = titlePresetFor(slide.motion)
  const enterAt = timing.start + duration * 0.06
  const contentAt = timing.start + duration * 0.18
  const emphasisAt = timing.start + duration * 0.72
  const titleDuration = clamp(duration * 0.14, 0.45, 1)
  const contentDuration = clamp(duration * 0.12, 0.45, 0.85)

  if (slide.type === 'hero') {
    return [
      step(`${root} .slide__title`, slide.motion === 'progressive-reveal' ? 'cinematic-rise' : titlePreset, enterAt, titleDuration),
      step(`${root} .slide__subtitle`, 'blur-rise', enterAt + duration * 0.08, contentDuration),
      step(`${root} .point`, 'stagger-up', contentAt, contentDuration, 0.16),
    ]
  }

  if (slide.type === 'section') {
    return [
      step(`${root} .slide__title`, 'wipe', enterAt, titleDuration),
      step(`${root} .slide__subtitle`, 'fade-in', enterAt + duration * 0.1, contentDuration),
      step(`${root} .section__rule`, 'line-draw', contentAt, contentDuration),
    ]
  }

  if (slide.type === 'comparison') {
    return [
      step(`${root} .slide__title`, titlePreset, enterAt, titleDuration),
      step(`${root} .slide__subtitle`, 'fade-in', enterAt + duration * 0.08, contentDuration),
      step(`${root} .comparison__side`, 'card-stack', contentAt, contentDuration, 0.18),
    ]
  }

  if (slide.type === 'process') {
    return [
      step(`${root} .slide__title`, titlePreset, enterAt, titleDuration),
      step(`${root} .process-list .point`, 'stagger-up', contentAt, contentDuration, 0.14),
    ]
  }

  if (slide.type === 'timeline') {
    return [
      step(`${root} .slide__title`, titlePreset, enterAt, titleDuration),
      step(`${root} .timeline__line`, 'line-draw', contentAt, duration * 0.5),
      step(`${root} .timeline__item`, 'stagger-up', contentAt + duration * 0.06, contentDuration, 0.16),
    ]
  }

  if (slide.type === 'quote') {
    return [
      step(`${root} .slide__title`, 'fade-in', enterAt, contentDuration),
      step(`${root} .quote-block`, 'soft-scale', contentAt, titleDuration),
    ]
  }

  if (slide.type === 'stat') {
    return [
      step(`${root} .slide__title`, 'fade-in', enterAt, contentDuration),
      step(`${root} .stat-block`, 'number-count', contentAt, titleDuration),
      step(`${root} .stat-block strong`, 'spotlight', emphasisAt, 0.55),
    ]
  }

  if (slide.type === 'chart') {
    return [
      step(`${root} .slide__title`, titlePreset, enterAt, titleDuration),
      step(`${root} .chart-bar`, 'stagger-up', contentAt, contentDuration, 0.14),
      step(`${root} .chart-bar i`, 'line-draw', contentAt + duration * 0.1, contentDuration, 0.12),
    ]
  }

  if (slide.type === 'code') {
    return [
      step(`${root} .slide__title`, titlePreset, enterAt, titleDuration),
      step(`${root} .code-block`, 'blur-rise', contentAt, titleDuration),
    ]
  }

  if (slide.type === 'cta') {
    return [
      step(`${root} .slide__title`, 'zoom-focus', enterAt, titleDuration),
      step(`${root} .cta-block`, 'soft-scale', contentAt, titleDuration),
    ]
  }

  return [
    step(`${root} .slide__title`, titlePreset, enterAt, titleDuration),
    step(`${root} .slide__subtitle`, 'fade-in', enterAt + duration * 0.08, contentDuration),
    step(`${root} .idea-card, ${root} .point`, 'stagger-up', contentAt, contentDuration, 0.16),
  ]
}

function titlePresetFor(preset: DeckMotionPreset): DeckMotionPreset {
  if (preset === 'stagger-up' || preset === 'progressive-reveal' || preset === 'card-stack') {
    return 'blur-rise'
  }

  if (preset === 'number-count' || preset === 'line-draw' || preset === 'spotlight') {
    return 'slide-up'
  }

  return preset
}

function step(selector: string, preset: DeckMotionPreset, at: number, duration: number, stagger?: number): DeckMotionStep {
  return {
    at: round(at),
    duration: round(Math.max(0.001, duration)),
    preset,
    selector,
    ...(stagger === undefined ? {} : {stagger: round(stagger)}),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function cssEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}
