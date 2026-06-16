import type {LongVideoSelectedMoments, MediaInfo, Narration, Storyboard} from '@video-agent/ir'

import type {QualityIssue} from './timeline.js'

export interface ExplainerStructureInput {
  mediaInfo: MediaInfo
  narration: Narration
  selectedMoments?: LongVideoSelectedMoments
  storyboard: Storyboard
}

export interface ExplainerStructureOptions {
  maxNarrationCharacters?: number
  maxSegmentDuration?: number
  minLongVideoDuration?: number
  targetSegmentDuration?: number
}

export function checkExplainerStructure(input: ExplainerStructureInput, options: ExplainerStructureOptions = {}): QualityIssue[] {
  if (input.selectedMoments === undefined) {
    return []
  }

  const duration = input.mediaInfo.duration ?? inferSelectedMomentsDuration(input.selectedMoments)
  const minLongVideoDuration = options.minLongVideoDuration ?? 60

  if (duration < minLongVideoDuration) {
    return []
  }

  const maxSegmentDuration = options.maxSegmentDuration ?? 60
  const maxNarrationCharacters = options.maxNarrationCharacters ?? 700
  const targetSegmentDuration = options.targetSegmentDuration ?? maxSegmentDuration
  const expectedSegments = Math.max(2, Math.ceil(duration / targetSegmentDuration))
  const issues: QualityIssue[] = []

  if (input.selectedMoments.moments.length < expectedSegments) {
    issues.push({
      code: 'explainer.selected_moments.too_few',
      message: `Long-video explainer has ${input.selectedMoments.moments.length} selected moment(s) for ${formatSeconds(duration)}s of source; expected at least ${expectedSegments}.`,
      severity: 'warning',
    })
  }

  if (input.storyboard.scenes.length < input.selectedMoments.moments.length) {
    issues.push({
      code: 'explainer.storyboard.collapsed',
      message: `Storyboard has ${input.storyboard.scenes.length} scene(s) for ${input.selectedMoments.moments.length} selected moment(s).`,
      severity: 'warning',
    })
  }

  if (input.narration.segments.length < input.storyboard.scenes.length) {
    issues.push({
      code: 'explainer.narration.collapsed',
      message: `Narration has ${input.narration.segments.length} segment(s) for ${input.storyboard.scenes.length} storyboard scene(s).`,
      severity: 'warning',
    })
  }

  const nonSlideScenes = input.storyboard.scenes.filter((scene) => scene.visualStyle !== 'slide_explainer')

  if (nonSlideScenes.length > 0) {
    issues.push({
      code: 'explainer.storyboard.visual_style',
      message: `Long-video explainer contains ${nonSlideScenes.length} storyboard scene(s) that are not slide_explainer.`,
      severity: 'warning',
    })
  }

  const longScenes = input.storyboard.scenes.filter((scene) => scene.duration > maxSegmentDuration)

  if (longScenes.length > 0) {
    issues.push({
      code: 'explainer.storyboard.segment_too_long',
      message: `Long-video explainer contains ${longScenes.length} storyboard scene(s) longer than ${formatSeconds(maxSegmentDuration)}s.`,
      severity: 'warning',
    })
  }

  const longNarrationSegments = input.narration.segments.filter((segment) => (segment.duration ?? 0) > maxSegmentDuration)

  if (longNarrationSegments.length > 0) {
    issues.push({
      code: 'explainer.narration.segment_too_long',
      message: `Long-video explainer contains ${longNarrationSegments.length} narration segment(s) longer than ${formatSeconds(maxSegmentDuration)}s.`,
      severity: 'warning',
    })
  }

  const verboseNarrationSegments = input.narration.segments.filter((segment) => segment.text.length > maxNarrationCharacters)

  if (verboseNarrationSegments.length > 0) {
    issues.push({
      code: 'explainer.narration.text_too_long',
      message: `Long-video explainer contains ${verboseNarrationSegments.length} narration segment(s) over ${maxNarrationCharacters} characters.`,
      severity: 'warning',
    })
  }

  return issues
}

function inferSelectedMomentsDuration(selectedMoments: LongVideoSelectedMoments): number {
  return selectedMoments.moments.reduce((duration, moment) => Math.max(duration, moment.sourceRange[1]), 0)
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
