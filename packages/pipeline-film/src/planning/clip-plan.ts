import type {ClipPlan, ClipPlanItem, OutputTimelineMap, RecapScript, RecapScriptSegment, SourceManifest, StoryIndex} from '@video-agent/ir'

import {requireProviderSourceRange} from './validation.js'
import {rangesOverlap, roundSeconds} from '../shared/utils.js'

export function createFilmClipPlan(sourceManifest: SourceManifest, storyIndex: StoryIndex, targetDuration: number | undefined, recapScript: RecapScript): ClipPlan {
  const scriptDrivenPlan = createScriptDrivenFilmClipPlan(sourceManifest, storyIndex, recapScript, targetDuration)

  if (scriptDrivenPlan.clips.length === 0) {
    throw new Error('Film Recap clip planning produced no script-driven clips.')
  }

  return scriptDrivenPlan
}

export function validateClipPlanForCut(clipPlan: ClipPlan): ClipPlan {
  let outputCursor = 0
  const clips = clipPlan.clips.map((clip) => {
    if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
      throw new Error(`Clip ${clip.id} has non-positive duration; no invalid clip filtering is allowed before cut rendering.`)
    }

    if (!Number.isFinite(clip.sourceRange[0]) || !Number.isFinite(clip.sourceRange[1]) || clip.sourceRange[1] <= clip.sourceRange[0]) {
      throw new Error(`Clip ${clip.id} has invalid sourceRange; no invalid clip filtering is allowed before cut rendering.`)
    }

    const duration = roundSeconds(clip.sourceRange[1] - clip.sourceRange[0])
    const start = roundSeconds(outputCursor)

    outputCursor = roundSeconds(outputCursor + duration)

    return {
      ...clip,
      duration,
      start,
    }
  })
  const duration = roundSeconds(clips.reduce((total, clip) => total + clip.duration, 0))

  return {
    ...clipPlan,
    clips,
    duration,
  }
}

export function createOutputTimelineMap(clipPlan: ClipPlan): OutputTimelineMap {
  return {
    clips: clipPlan.clips.map((clip) => ({
      clipId: clip.id,
      outputEnd: roundSeconds(clip.start + clip.duration),
      outputStart: clip.start,
      sourceEnd: clip.sourceRange[1],
      sourceStart: clip.sourceRange[0],
    })),
    outputDuration: clipPlan.duration,
    source: clipPlan.source,
    version: 1,
  }
}

function createScriptDrivenFilmClipPlan(sourceManifest: SourceManifest, storyIndex: StoryIndex, recapScript: RecapScript, targetDuration: number | undefined): ClipPlan {
  const beatsById = new Map(storyIndex.beats.map((beat) => [beat.id, beat]))
  const scriptTarget = requirePositiveScriptTarget(recapScript, sourceManifest.duration)
  const effectiveTarget = targetDuration === undefined
    ? scriptTarget
    : requireClipPlanTargetDuration(targetDuration, sourceManifest.duration)
  const clips: ClipPlanItem[] = []
  let outputCursor = 0

  assertRecapScriptDurationMatchesTarget(recapScript, effectiveTarget)

  for (const [segmentIndex, segment] of recapScript.segments.entries()) {
    const beat = requireSingleTargetBeat(segment, beatsById)
    const sourceRange = requireScriptSegmentSourceRange(segment, sourceManifest.duration)

    if (clips.some((clip) => rangesOverlap(clip.sourceRange, sourceRange))) {
      throw new Error(`Recap script segment ${segment.id} produced an overlapping LLM-selected clip.`)
    }

    const duration = roundSeconds(sourceRange[1] - sourceRange[0])

    clips.push({
      beatId: beat.id,
      duration,
      id: `clip-${String(clips.length + 1).padStart(3, '0')}`,
      reason: segment.clipSelectionReason,
      sceneId: beat.id,
      scriptSegmentId: segment.id,
      selectionReason: segment.clipSelectionReason,
      selectionRank: segmentIndex + 1,
      source: sourceManifest.sourcePath,
      sourceRange,
      start: roundSeconds(outputCursor),
    })
    outputCursor = roundSeconds(outputCursor + duration)
  }

  return {
    clips,
    duration: roundSeconds(outputCursor),
    source: sourceManifest.sourcePath,
    sourceDuration: sourceManifest.duration,
    version: 1,
  }
}

function requireSingleTargetBeat(segment: RecapScriptSegment, beatsById: Map<string, StoryIndex['beats'][number]>): StoryIndex['beats'][number] {
  if (segment.targetBeatIds.length !== 1) {
    throw new Error(`Recap script segment ${segment.id} must reference exactly one story-index beat; no runtime beat selection fallback is allowed.`)
  }

  const beatId = segment.targetBeatIds[0]
  const beat = beatId === undefined ? undefined : beatsById.get(beatId)

  if (beat === undefined) {
    throw new Error(`Recap script segment ${segment.id} references unknown story-index beat ${JSON.stringify(beatId)}; no runtime beat filtering fallback is allowed.`)
  }

  return beat
}

function requireScriptSegmentSourceRange(segment: RecapScriptSegment, sourceDuration: number): [number, number] {
  const sourceRange = requireProviderSourceRange(segment.sourceRange, sourceDuration, `Recap script segment ${segment.id}`)
  const duration = roundSeconds(sourceRange[1] - sourceRange[0])

  if (duration <= 0) {
    throw new Error(`Recap script segment ${segment.id} must provide a positive sourceRange for LLM-driven clip planning.`)
  }

  if (Math.abs(duration - roundSeconds(segment.suggestedDuration)) > 0.001) {
    throw new Error(`Recap script segment ${segment.id} suggestedDuration must match its LLM-selected sourceRange duration; no runtime clip truncation is allowed.`)
  }

  return sourceRange
}

function assertRecapScriptDurationMatchesTarget(recapScript: RecapScript, effectiveTarget: number): void {
  const segmentDuration = roundSeconds(recapScript.segments.reduce((total, segment) => total + Math.max(0, segment.suggestedDuration), 0))
  const scriptDuration = roundSeconds(recapScript.totalEstimatedDuration)
  const targetDuration = roundSeconds(effectiveTarget)

  if (Math.abs(segmentDuration - scriptDuration) > 0.001) {
    throw new Error(`Film Recap clip planning requires recapScript.totalEstimatedDuration ${scriptDuration}s to match segment suggestedDuration sum ${segmentDuration}s.`)
  }

  if (Math.abs(scriptDuration - targetDuration) > 0.001) {
    throw new Error(`Film Recap clip planning requires LLM-authored recapScript.totalEstimatedDuration ${scriptDuration}s to match target duration ${targetDuration}s; no runtime duration scaling is allowed.`)
  }
}

function requirePositiveScriptTarget(recapScript: RecapScript, sourceDuration: number): number {
  const scriptTarget = roundSeconds(recapScript.totalEstimatedDuration)

  if (!Number.isFinite(scriptTarget) || scriptTarget <= 0) {
    throw new Error('Film Recap clip planning requires a positive LLM-authored recapScript.totalEstimatedDuration.')
  }

  if (sourceDuration > 0 && scriptTarget > sourceDuration) {
    throw new Error('Film Recap clip planning requires LLM-authored recapScript.totalEstimatedDuration to stay within source duration; no runtime target duration clipping is allowed.')
  }

  return scriptTarget
}

function requireClipPlanTargetDuration(targetDuration: number, sourceDuration: number): number {
  const roundedTargetDuration = roundSeconds(targetDuration)

  if (!Number.isFinite(roundedTargetDuration) || roundedTargetDuration <= 0) {
    throw new Error('Film Recap clip planning requires positive targetDurationSeconds; no runtime target duration clipping is allowed.')
  }

  if (sourceDuration > 0 && roundedTargetDuration > sourceDuration) {
    throw new Error('Film Recap clip planning requires targetDurationSeconds to stay within source duration; no runtime target duration clipping is allowed.')
  }

  return roundedTargetDuration
}
