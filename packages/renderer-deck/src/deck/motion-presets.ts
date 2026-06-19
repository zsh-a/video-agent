import type {DeckMotionPreset, MotionEasing, MotionProperty} from '@video-agent/ir'

export interface MotionPresetState {
  easing: MotionEasing
  properties: MotionPresetProperty[]
}

export interface MotionPresetProperty {
  from: number
  property: MotionProperty
  to: number
}

const BLUR_FREE_PRESETS: Partial<Record<DeckMotionPreset, DeckMotionPreset>> = {
  'blur-rise': 'slide-up',
  'progressive-reveal': 'stagger-up',
  'zoom-focus': 'soft-scale',
}

export function resolveBlurFreePreset(preset: DeckMotionPreset, blurFree: boolean | undefined): DeckMotionPreset {
  return blurFree && preset in BLUR_FREE_PRESETS ? BLUR_FREE_PRESETS[preset]! : preset
}

export function motionPresetState(preset: DeckMotionPreset, options?: {blurFree?: boolean}): MotionPresetState {
  const resolvedPreset = resolveBlurFreePreset(preset, options?.blurFree)

  if (resolvedPreset !== preset) {
    return motionPresetState(resolvedPreset, options)
  }

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

  if (preset === 'rotate') {
    return presetState('easeOutCubic', [
      property('opacity', 0, 1),
      property('rotate', -8, 0),
      property('scale', 0.98, 1),
    ])
  }

  if (preset === 'spin') {
    return presetState('easeOutExpo', [
      property('opacity', 0, 1),
      property('rotate', -180, 0),
      property('scale', 0.9, 1),
    ])
  }

  if (preset === 'spring') {
    return presetState('easeOutExpo', [
      property('opacity', 0, 1),
      property('scale', 0.86, 1),
      property('translateY', 42, 0),
    ])
  }

  if (preset === 'bounce') {
    return presetState('easeOutExpo', [
      property('opacity', 0, 1),
      property('scale', 0.82, 1),
      property('translateY', -32, 0),
    ])
  }

  if (preset === 'typewriter') {
    return presetState('linear', [
      property('opacity', 0, 1),
      property('translateX', -10, 0),
    ])
  }

  if (preset === 'parallax') {
    return presetState('easeOutCubic', [
      property('opacity', 0, 1),
      property('scale', 1.04, 1),
      property('translateY', 70, 0),
    ])
  }

  return presetState('easeOutExpo', [
    property('opacity', 0, 1),
    property('scale', 0.96, 1),
    property('translateY', 60, 0),
  ])
}

export function titlePresetFor(preset: DeckMotionPreset): DeckMotionPreset {
  if (preset === 'stagger-up' || preset === 'progressive-reveal' || preset === 'card-stack' || preset === 'parallax') {
    return 'blur-rise'
  }

  if (preset === 'number-count' || preset === 'line-draw' || preset === 'spotlight' || preset === 'typewriter') {
    return 'slide-up'
  }

  return preset
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
