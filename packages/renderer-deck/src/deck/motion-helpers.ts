import {clamp} from './motion.js'

export interface SlideTimingConfig {
  contentAt: number
  contentDuration: (slideDuration: number) => number
  emphasisAt: number
  enterAt: number
  titleDuration: (slideDuration: number) => number
}

export function slideTiming(slideDuration: number): SlideTimingConfig {
  const speed = slideDuration < 20 ? 'fast' : slideDuration > 30 ? 'slow' : 'normal'

  if (speed === 'fast') {
    return {
      contentAt: 0.14,
      contentDuration: (d) => clamp(d * 0.10, 0.4, 0.85),
      emphasisAt: 0.65,
      enterAt: 0.04,
      titleDuration: (d) => clamp(d * 0.12, 0.4, 1),
    }
  }

  if (speed === 'slow') {
    return {
      contentAt: 0.22,
      contentDuration: (d) => clamp(d * 0.14, 0.45, 0.9),
      emphasisAt: 0.78,
      enterAt: 0.08,
      titleDuration: (d) => clamp(d * 0.16, 0.5, 1.1),
    }
  }

  return {
    contentAt: 0.18,
    contentDuration: (d) => clamp(d * 0.12, 0.45, 0.85),
    emphasisAt: 0.72,
    enterAt: 0.06,
    titleDuration: (d) => clamp(d * 0.14, 0.45, 1),
  }
}
