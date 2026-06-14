import type {Storyboard, Timeline} from '@video-agent/ir'

export interface HyperframesRenderPlan {
  assetsDir: string
  entryHtml: string
  storyboard: Storyboard
  timeline: Timeline
}

export function createHyperframesRenderPlan(input: HyperframesRenderPlan): HyperframesRenderPlan {
  return input
}
