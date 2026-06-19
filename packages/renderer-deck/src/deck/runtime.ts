import type {MotionProperty} from '@video-agent/ir'

import {MotionPropertySchema} from '@video-agent/ir'

const MOTION_PROPERTY_DEFAULTS = {
  blur: 0,
  opacity: 1,
  rotate: 0,
  scale: 1,
  scaleX: 1,
  translateX: 0,
  translateY: 0,
} satisfies Record<MotionProperty, number>

const MOTION_PROPERTY_DEFAULTS_SCRIPT = JSON.stringify(MotionPropertySchema.options.reduce<Record<MotionProperty, number>>((defaults, property) => ({
  ...defaults,
  [property]: MOTION_PROPERTY_DEFAULTS[property],
}), {} as Record<MotionProperty, number>))

export function createDeckRuntimeScript(): string {
  return `const motionPropertyDefaults = ${MOTION_PROPERTY_DEFAULTS_SCRIPT}
const planElement = document.getElementById('deck-render-plan')
const plan = planElement === null ? undefined : JSON.parse(planElement.textContent || '{}')
const url = new URL(window.location.href)
const requestedTimeParam = url.searchParams.get('time')
const requestedTime = requestedTimeParam === null ? undefined : Number(requestedTimeParam)
const requestedSlide = url.searchParams.get('slide')
const slides = Array.from(document.querySelectorAll('[data-slide]'))
const slideState = new Map((plan?.motion?.slides || []).map((slide) => [slide.slideId, slide]))
const transitionsIn = new Map((plan?.motion?.transitions || []).map((transition) => [transition.to, transition]))
const transitionsOut = new Map((plan?.motion?.transitions || []).map((transition) => [transition.from, transition]))
let raf = 0
let playing = false
let playStartedAt = 0
let playStartedTime = 0
let lastTime = 0

async function ready() {
  if (document.fonts !== undefined) {
    await document.fonts.ready
  }
}

function seek(timeSeconds) {
  const time = clamp(Number(timeSeconds) || 0, 0, duration())
  lastTime = time

  for (const slide of slides) {
    const slideId = slide.getAttribute('data-slide')
    const state = slideState.get(slideId) || readSlideState(slide)
    const active = time >= state.start && time <= state.end
    const localDuration = Math.max(0.001, state.end - state.start)
    const enterTransition = transitionsIn.get(slideId)
    const exitTransition = transitionsOut.get(slideId)
    const enterDuration = Math.min(enterTransition?.duration || 0.32, localDuration * 0.22)
    const exitDuration = Math.min(exitTransition?.duration || 0.32, localDuration * 0.22)
    const enterOpacity = clamp((time - state.start) / enterDuration, 0, 1)
    const exitOpacity = clamp((state.end - time) / exitDuration, 0, 1)

    slide.dataset.active = active ? 'true' : 'false'
    applySlideTransitionState(slide, {
      active,
      enterOpacity,
      enterProgress: enterOpacity,
      enterTransition,
      exitOpacity,
      exitProgress: exitOpacity,
      exitTransition,
    })
  }

  applyMotionTimeline(time)

  document.body.dataset.motionReady = 'true'
}

function play() {
  if (playing) {
    return
  }

  playing = true
  playStartedAt = performance.now()
  playStartedTime = currentTime()
  raf = requestAnimationFrame(tick)
}

function pause() {
  playing = false
  cancelAnimationFrame(raf)
}

function tick(now) {
  if (!playing) {
    return
  }

  const next = playStartedTime + (now - playStartedAt) / 1000
  seek(next)

  if (next >= duration()) {
    playing = false
    return
  }

  raf = requestAnimationFrame(tick)
}

function duration() {
  return Number(plan?.motion?.duration || plan?.duration || 0)
}

function currentTime() {
  return lastTime
}

function applyMotionTimeline(time) {
  const states = new Map()

  for (const track of plan?.motion?.timeline?.tracks || []) {
    if (track.target?.kind !== 'css-selector') {
      continue
    }

    const elements = Array.from(document.querySelectorAll(track.target.value))

    elements.forEach((element, index) => {
      const at = track.start + index * (track.stagger || 0)
      const progress = ease(track.easing, clamp((time - at) / track.duration, 0, 1))
      const state = stateForElement(states, element)

      state[track.property] = mix(track.from, track.to, progress)
    })
  }

  for (const [element, state] of states.entries()) {
    applyElementState(element, state)
  }
}

function stateForElement(states, element) {
  const existing = states.get(element)

  if (existing !== undefined) {
    return existing
  }

  const state = {...motionPropertyDefaults}

  states.set(element, state)

  return state
}

function applyElementState(element, state) {
  element.style.opacity = String(state.opacity)
  element.style.filter = 'blur(' + state.blur + 'px)'
  element.style.transformOrigin = state.scaleX !== 1 ? 'left center' : 'center'
  element.style.transform = [
    'translate3d(' + state.translateX + 'px, ' + state.translateY + 'px, 0)',
    'rotate(' + state.rotate + 'deg)',
    'scale(' + state.scale + ')',
    'scaleX(' + state.scaleX + ')',
  ].join(' ')
}

function applySlideTransitionState(slide, state) {
  if (!state.active) {
    slide.style.opacity = '0'
    slide.style.transform = ''
    return
  }

  const opacity = Math.min(state.enterOpacity, state.exitOpacity)
  const transform = slideTransitionTransform(state)

  slide.style.opacity = String(opacity)
  slide.style.transform = transform
}

function slideTransitionTransform(state) {
  if (state.enterProgress < 1) {
    return transformForTransition(state.enterTransition?.type, 1 - state.enterProgress, 'in')
  }

  if (state.exitProgress < 1) {
    return transformForTransition(state.exitTransition?.type, 1 - state.exitProgress, 'out')
  }

  return ''
}

function transformForTransition(type, amount, direction) {
  if (type === 'slide-left') {
    const value = direction === 'in' ? amount * 86 : amount * -86

    return 'translate3d(' + value + 'px, 0, 0)'
  }

  if (type === 'slide-up') {
    const value = direction === 'in' ? amount * 72 : amount * -72

    return 'translate3d(0, ' + value + 'px, 0)'
  }

  return ''
}

function readSlideState(slide) {
  return {
    end: Number(slide.getAttribute('data-end') || 0),
    slideId: slide.getAttribute('data-slide') || '',
    start: Number(slide.getAttribute('data-start') || 0),
  }
}

function mix(from, to, progress) {
  return from + (to - from) * progress
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function ease(name, value) {
  if (name === 'easeOutExpo') {
    return easeOutExpo(value)
  }

  if (name === 'linear') {
    return value
  }

  return easeOutCubic(value)
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3)
}

function easeOutExpo(value) {
  return value >= 1 ? 1 : 1 - Math.pow(2, -10 * value)
}

function previewTimeForSlide(slideId) {
  const state = slideState.get(slideId)

  if (state === undefined) {
    return 0
  }

  const localDuration = Math.max(0.001, state.end - state.start)
  const exitMargin = Math.min(0.32, localDuration * 0.12)
  const minPreviewTime = state.start + Math.min(0.5, localDuration * 0.2)
  const maxPreviewTime = Math.max(state.start, state.end - exitMargin - 0.05)
  const latestMotionEnd = latestMotionEndForSlide(slideId)
  const targetTime = latestMotionEnd === undefined
    ? state.start + Math.max(0.35, localDuration * 0.35)
    : latestMotionEnd + 0.2

  if (maxPreviewTime < minPreviewTime) {
    return state.start + localDuration * 0.5
  }

  return clamp(targetTime, minPreviewTime, maxPreviewTime)
}

function latestMotionEndForSlide(slideId) {
  let latest
  const marker = '[data-slide="' + slideId + '"]'

  for (const track of plan?.motion?.timeline?.tracks || []) {
    if (track.target?.kind !== 'css-selector' || !track.target.value.includes(marker)) {
      continue
    }

    const count = Math.max(1, document.querySelectorAll(track.target.value).length)
    const stagger = track.stagger || 0
    const trackEnd = track.start + track.duration + Math.max(0, count - 1) * stagger

    latest = latest === undefined ? trackEnd : Math.max(latest, trackEnd)
  }

  return latest
}

function firstSlidePreviewTime() {
  const firstSlideId = slides[0]?.getAttribute('data-slide')

  return firstSlideId === undefined || firstSlideId === null ? 0 : previewTimeForSlide(firstSlideId)
}

window.vagent = {
  duration,
  pause,
  play,
  seek,
}

await ready()

const initialTime = Number.isFinite(requestedTime)
  ? requestedTime
  : requestedSlide === null
    ? firstSlidePreviewTime()
    : previewTimeForSlide(requestedSlide)

seek(initialTime)
`
}
