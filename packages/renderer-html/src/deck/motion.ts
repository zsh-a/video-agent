import type {DeckMotionPreset, MotionEasing, MotionProperty, MotionTimeline, Slide, TimedDeck} from '@video-agent/ir'

import {MotionTimelineSchema} from '@video-agent/ir'

export interface DeckMotionPlan {
  duration: number
  slides: DeckMotionSlide[]
  timeline: MotionTimeline
  version: 1
}

export interface DeckMotionSlide {
  end: number
  slideId: string
  start: number
}

interface DeckMotionStep {
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
  const timeline = compileMotionTimeline({
    fps: 30,
    slides,
    steps,
  })

  return {
    duration: timeline.duration,
    slides,
    timeline,
    version: 1,
  }
}

function compileMotionTimeline(input: {
  fps: number
  slides: DeckMotionSlide[]
  steps: DeckMotionStep[]
}): MotionTimeline {
  const tracks = input.steps.flatMap((step, index) => tracksForStep(step, index))
  const duration = round(Math.max(input.slides.at(-1)?.end ?? 0, ...tracks.map((track) => track.start + track.duration)))

  return MotionTimelineSchema.parse({
    duration,
    fps: input.fps,
    scenes: input.slides.map((slide) => ({
      end: slide.end,
      id: slide.slideId,
      sourceId: slide.slideId,
      start: slide.start,
    })),
    tracks,
    version: 1,
  })
}

function tracksForStep(step: DeckMotionStep, stepIndex: number): MotionTimeline['tracks'] {
  const preset = motionPresetState(step.preset)

  return preset.properties.flatMap(({from, property, to}, propertyIndex) => {
    if (from === to) {
      return []
    }

    return [{
      duration: step.duration,
      easing: preset.easing,
      from,
      id: `step-${String(stepIndex + 1).padStart(3, '0')}-${property}-${propertyIndex + 1}`,
      property,
      ...(step.stagger === undefined ? {} : {stagger: step.stagger}),
      start: step.at,
      target: {
        kind: 'css-selector' as const,
        value: step.selector,
      },
      to,
    }]
  })
}

interface MotionPresetState {
  easing: MotionEasing
  properties: MotionPresetProperty[]
}

interface MotionPresetProperty {
  from: number
  property: MotionProperty
  to: number
}

function motionPresetState(preset: DeckMotionPreset): MotionPresetState {
  if (preset === 'fade-in') {
    return presetState('easeOutCubic', [
      property('opacity', 0, 1),
    ])
  }

  if (preset === 'slide-up') {
    return presetState('easeOutCubic', [
      property('opacity', 0, 1),
      property('translateY', 36, 0),
    ])
  }

  if (preset === 'soft-scale') {
    return presetState('easeOutExpo', [
      property('opacity', 0, 1),
      property('scale', 0.96, 1),
    ])
  }

  if (preset === 'blur-rise') {
    return presetState('easeOutCubic', [
      property('blur', 12, 0),
      property('opacity', 0, 1),
      property('translateY', 44, 0),
    ])
  }

  if (preset === 'stagger-up') {
    return presetState('easeOutCubic', [
      property('opacity', 0, 1),
      property('translateY', 34, 0),
    ])
  }

  if (preset === 'progressive-reveal') {
    return presetState('easeOutCubic', [
      property('blur', 8, 0),
      property('opacity', 0, 1),
      property('translateY', 28, 0),
    ])
  }

  if (preset === 'card-stack') {
    return presetState('easeOutCubic', [
      property('opacity', 0, 1),
      property('scale', 0.98, 1),
      property('translateY', 30, 0),
    ])
  }

  if (preset === 'line-draw') {
    return presetState('easeOutCubic', [
      property('scaleX', 0, 1),
    ])
  }

  if (preset === 'number-count') {
    return presetState('easeOutExpo', [
      property('opacity', 0, 1),
      property('scale', 0.92, 1),
      property('translateY', 26, 0),
    ])
  }

  if (preset === 'spotlight') {
    return presetState('easeOutCubic', [
      property('scale', 1, 1.035),
    ])
  }

  if (preset === 'wipe') {
    return presetState('easeOutCubic', [
      property('opacity', 0, 1),
      property('translateX', -34, 0),
    ])
  }

  if (preset === 'zoom-focus') {
    return presetState('easeOutExpo', [
      property('blur', 8, 0),
      property('opacity', 0, 1),
      property('scale', 0.94, 1),
    ])
  }

  return presetState('easeOutExpo', [
    property('opacity', 0, 1),
    property('scale', 0.96, 1),
    property('translateY', 60, 0),
  ])
}

function presetState(easing: MotionEasing, properties: MotionPresetProperty[]): MotionPresetState {
  return {
    easing,
    properties,
  }
}

function property(property: MotionProperty, from: number, to: number): MotionPresetProperty {
  return {
    from,
    property,
    to,
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
