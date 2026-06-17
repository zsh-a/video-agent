export function createDeckRuntimeScript(): string {
  return `const planElement = document.getElementById('deck-render-plan')
const plan = planElement === null ? undefined : JSON.parse(planElement.textContent || '{}')
const url = new URL(window.location.href)
const requestedTimeParam = url.searchParams.get('time')
const requestedTime = requestedTimeParam === null ? undefined : Number(requestedTimeParam)
const requestedSlide = url.searchParams.get('slide')
const slides = Array.from(document.querySelectorAll('[data-slide]'))
const slideState = new Map((plan?.motion?.slides || []).map((slide) => [slide.slideId, slide]))
let raf = 0
let playing = false
let playStartedAt = 0
let playStartedTime = 0
let lastTime = 0

const PRESETS = {
  'fade-in': {
    ease: easeOutCubic,
    from: {opacity: 0},
    to: {opacity: 1},
  },
  'slide-up': {
    ease: easeOutCubic,
    from: {opacity: 0, y: 36},
    to: {opacity: 1, y: 0},
  },
  'soft-scale': {
    ease: easeOutExpo,
    from: {opacity: 0, scale: 0.96},
    to: {opacity: 1, scale: 1},
  },
  'blur-rise': {
    ease: easeOutCubic,
    from: {blur: 12, opacity: 0, y: 44},
    to: {blur: 0, opacity: 1, y: 0},
  },
  'stagger-up': {
    ease: easeOutCubic,
    from: {opacity: 0, y: 34},
    to: {opacity: 1, y: 0},
  },
  'progressive-reveal': {
    ease: easeOutCubic,
    from: {blur: 8, opacity: 0, y: 28},
    to: {blur: 0, opacity: 1, y: 0},
  },
  'card-stack': {
    ease: easeOutCubic,
    from: {opacity: 0, scale: 0.98, y: 30},
    to: {opacity: 1, scale: 1, y: 0},
  },
  'line-draw': {
    ease: easeOutCubic,
    from: {opacity: 1, scaleX: 0},
    to: {opacity: 1, scaleX: 1},
  },
  'number-count': {
    ease: easeOutExpo,
    from: {opacity: 0, scale: 0.92, y: 26},
    to: {opacity: 1, scale: 1, y: 0},
  },
  'spotlight': {
    ease: easeOutCubic,
    from: {opacity: 1, scale: 1},
    to: {opacity: 1, scale: 1.035},
  },
  'wipe': {
    ease: easeOutCubic,
    from: {opacity: 0, x: -34},
    to: {opacity: 1, x: 0},
  },
  'zoom-focus': {
    ease: easeOutExpo,
    from: {blur: 8, opacity: 0, scale: 0.94},
    to: {blur: 0, opacity: 1, scale: 1},
  },
  'cinematic-rise': {
    ease: easeOutExpo,
    from: {opacity: 0, scale: 0.96, y: 60},
    to: {opacity: 1, scale: 1, y: 0},
  },
}

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
    const enterDuration = Math.min(0.32, localDuration * 0.12)
    const exitDuration = Math.min(0.32, localDuration * 0.12)
    const enterOpacity = clamp((time - state.start) / enterDuration, 0, 1)
    const exitOpacity = clamp((state.end - time) / exitDuration, 0, 1)

    slide.dataset.active = active ? 'true' : 'false'
    slide.style.opacity = String(active ? Math.min(enterOpacity, exitOpacity) : 0)
  }

  for (const step of plan?.motion?.steps || []) {
    const elements = Array.from(document.querySelectorAll(step.selector))

    elements.forEach((element, index) => {
      const at = step.at + index * (step.stagger || 0)
      const progress = clamp((time - at) / step.duration, 0, 1)
      applyPreset(element, step.preset, progress)
    })
  }

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

function applyPreset(element, presetName, rawProgress) {
  const preset = PRESETS[presetName] || PRESETS['fade-in']
  const progress = preset.ease(rawProgress)
  const state = mixState(preset.from, preset.to, progress)

  element.style.opacity = String(state.opacity)
  element.style.filter = 'blur(' + state.blur + 'px)'
  element.style.transformOrigin = presetName === 'line-draw' ? 'left center' : 'center'
  element.style.transform = [
    'translate3d(' + state.x + 'px, ' + state.y + 'px, 0)',
    'scale(' + state.scale + ')',
    'scaleX(' + state.scaleX + ')',
  ].join(' ')
}

function mixState(from, to, progress) {
  return {
    blur: mix(from.blur ?? 0, to.blur ?? 0, progress),
    opacity: mix(from.opacity ?? 1, to.opacity ?? 1, progress),
    scale: mix(from.scale ?? 1, to.scale ?? 1, progress),
    scaleX: mix(from.scaleX ?? 1, to.scaleX ?? 1, progress),
    x: mix(from.x ?? 0, to.x ?? 0, progress),
    y: mix(from.y ?? 0, to.y ?? 0, progress),
  }
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

  for (const step of plan?.motion?.steps || []) {
    if (!step.selector.includes(marker)) {
      continue
    }

    const count = Math.max(1, document.querySelectorAll(step.selector).length)
    const stagger = step.stagger || 0
    const stepEnd = step.at + step.duration + Math.max(0, count - 1) * stagger

    latest = latest === undefined ? stepEnd : Math.max(latest, stepEnd)
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
