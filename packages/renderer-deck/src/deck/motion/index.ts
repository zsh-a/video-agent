import type {DeckMotionPreset, DeckSlideType, MotionTimeline, Slide, TimedDeck} from '@video-agent/ir'

import {MotionTimelineSchema} from '@video-agent/ir'

import {motionPresetState, resolveBlurFreePreset} from './presets.js'
import {compileTransitions, type DeckMotionTransition} from './transitions.js'
import {cssEscape, round} from './utils.js'
import type {TemplateMotionStep} from '../templates/define-template.js'

export type {DeckMotionTransition}
export {motionPresetState, titlePresetFor} from './presets.js'
export {clamp} from './utils.js'

export interface DeckMotionPlan {
  duration: number
  slides: DeckMotionSlide[]
  summary: DeckMotionSummary
  timeline: MotionTimeline
  transitions: DeckMotionTransition[]
  version: 1
}

export interface DeckMotionSummary {
  lines: string[]
  slides: DeckMotionSlideSummary[]
  trackCount: number
  transitionCount: number
}

export interface DeckMotionSlideSummary {
  presets: DeckMotionPreset[]
  slideId: string
  trackCount: number
  transitionIn?: DeckMotionTransition['type']
  transitionOut?: DeckMotionTransition['type']
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

export type ResolveMotionSteps = (type: DeckSlideType) => TemplateMotionStep[] | undefined

export interface MotionOptions {
  blurFree?: boolean
}

export function compileDeckMotionPlan(timedDeck: TimedDeck, resolveMotionSteps: ResolveMotionSteps, options?: MotionOptions): DeckMotionPlan {
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

    return timing === undefined ? [] : compileSlideSteps(slide, timing, resolveMotionSteps, options)
  })
  const timeline = compileMotionTimeline({
    fps: 30,
    options,
    slides,
    steps,
  })
  const transitions = compileTransitions(timedDeck.deck.slides, slides)
  const summary = summarizeMotionPlan({slides, steps, timeline, transitions})

  return {
    duration: timeline.duration,
    slides,
    summary,
    timeline,
    transitions,
    version: 1,
  }
}

function compileMotionTimeline(input: {
  fps: number
  options?: MotionOptions
  slides: DeckMotionSlide[]
  steps: DeckMotionStep[]
}): MotionTimeline {
  const tracks = input.steps.flatMap((step, index) => tracksForStep(step, index, input.options))
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

function tracksForStep(step: DeckMotionStep, stepIndex: number, options?: MotionOptions): MotionTimeline['tracks'] {
  const preset = motionPresetState(step.preset, options)

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

function compileSlideSteps(slide: Slide, timing: DeckMotionSlide, resolveMotionSteps: ResolveMotionSteps, options?: MotionOptions): DeckMotionStep[] {
  const templateSteps = resolveMotionSteps(slide.type)

  if (templateSteps === undefined || templateSteps.length === 0) {
    throw new Error(`No motionSteps registered for deck template "${slide.type}".`)
  }

  return resolveTemplateSteps(slide, timing, templateSteps, options)
}

function resolveTemplateSteps(slide: Slide, timing: DeckMotionSlide, templateSteps: TemplateMotionStep[], options?: MotionOptions): DeckMotionStep[] {
  const duration = Math.max(0.1, timing.end - timing.start)
  const root = `[data-slide="${cssEscape(slide.slideId)}"]`

  return templateSteps.map((templateStep) => {
    const rawPreset = typeof templateStep.preset === 'function'
      ? templateStep.preset(slide.motion)
      : templateStep.preset
    const resolvedPreset = resolveBlurFreePreset(rawPreset, options?.blurFree)

    return {
      at: round(timing.start + templateStep.at(duration)),
      duration: round(Math.max(0.001, templateStep.duration(duration))),
      preset: resolvedPreset,
      selector: `${root} ${templateStep.selector}`,
      ...(templateStep.stagger === undefined ? {} : {stagger: round(templateStep.stagger)}),
    }
  })
}

function summarizeMotionPlan(input: {
  slides: DeckMotionSlide[]
  steps: DeckMotionStep[]
  timeline: MotionTimeline
  transitions: DeckMotionTransition[]
}): DeckMotionSummary {
  const stepsBySlide = new Map(input.slides.map((slide) => [slide.slideId, [] as DeckMotionStep[]]))

  for (const step of input.steps) {
    const slideId = slideIdFromSelector(step.selector)

    if (slideId !== undefined) {
      stepsBySlide.get(slideId)?.push(step)
    }
  }

  const slides = input.slides.map((slide): DeckMotionSlideSummary => {
    const steps = stepsBySlide.get(slide.slideId) ?? []
    const transitionIn = input.transitions.find((transition) => transition.to === slide.slideId)?.type
    const transitionOut = input.transitions.find((transition) => transition.from === slide.slideId)?.type
    const presets = Array.from(new Set(steps.map((step) => step.preset)))
    const trackCount = input.timeline.tracks.filter((track) => track.target.kind === 'css-selector' && track.target.value.includes(`[data-slide="${cssEscape(slide.slideId)}"]`)).length

    return {
      presets,
      slideId: slide.slideId,
      trackCount,
      ...(transitionIn === undefined ? {} : {transitionIn}),
      ...(transitionOut === undefined ? {} : {transitionOut}),
    }
  })

  return {
    lines: [
      `Motion timeline: ${input.timeline.tracks.length} tracks across ${input.slides.length} slides.`,
      `Transitions: ${input.transitions.length}.`,
      ...slides.map((slide) => `${slide.slideId}: ${slide.trackCount} tracks, presets ${slide.presets.join(', ') || 'none'}${slide.transitionOut === undefined ? '' : `, out ${slide.transitionOut}`}.`),
    ],
    slides,
    trackCount: input.timeline.tracks.length,
    transitionCount: input.transitions.length,
  }
}

function slideIdFromSelector(selector: string): string | undefined {
  const match = /\[data-slide="((?:\\"|[^"])*)"\]/.exec(selector)

  return match?.[1]?.replaceAll('\\"', '"').replaceAll('\\\\', '\\')
}
