import type {ClipPlan, ClipPlanItem, OutputTimelineMap, RecapScript, RecapScriptSegment, SourceManifest, StoryIndex} from '@video-agent/ir'

import {defaultRecapTargetDuration} from './source.js'
import {normalizeSourceRange} from './validation.js'
import {clamp, rangesOverlap, roundSeconds} from '../shared/utils.js'

export function createFilmClipPlan(sourceManifest: SourceManifest, storyIndex: StoryIndex, targetDuration: number | undefined, recapScript: RecapScript): ClipPlan {
  const scriptDrivenPlan = createScriptDrivenFilmClipPlan(sourceManifest, storyIndex, recapScript, targetDuration)

  if (scriptDrivenPlan.clips.length === 0) {
    throw new Error('Film Recap clip planning produced no script-driven clips.')
  }

  return scriptDrivenPlan
}

export function validateClipPlanForCut(clipPlan: ClipPlan): ClipPlan {
  let outputCursor = 0
  const clips = clipPlan.clips.flatMap((clip) => {
    if (clip.duration <= 0 || clip.sourceRange[1] <= clip.sourceRange[0]) {
      return []
    }

    const duration = roundSeconds(clip.sourceRange[1] - clip.sourceRange[0])
    const start = roundSeconds(outputCursor)

    outputCursor = roundSeconds(outputCursor + duration)

    return [{
      ...clip,
      duration,
      start,
    }]
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
  const scriptTarget = recapScript.totalEstimatedDuration > 0 ? recapScript.totalEstimatedDuration : defaultRecapTargetDuration(sourceManifest.duration)
  const effectiveTarget = clamp(targetDuration ?? scriptTarget, 0, sourceManifest.duration)
  const clips: ClipPlanItem[] = []
  let outputCursor = 0

  for (const [segmentIndex, segment] of recapScript.segments.entries()) {
    if (outputCursor >= effectiveTarget - 0.001) {
      break
    }

    const targetBeats = segment.targetBeatIds
      .flatMap((beatId) => {
        const beat = beatsById.get(beatId)

        return beat === undefined ? [] : [beat]
      })

    if (targetBeats.length === 0) {
      throw new Error(`Recap script segment ${segment.id} does not reference any story-index beat.`)
    }

    const beat = targetBeats[0]
    const candidate = createScriptClipCandidate(segment, sourceManifest.duration, effectiveTarget - outputCursor)

    if (candidate === undefined) {
      throw new Error(`Recap script segment ${segment.id} must provide a positive sourceRange for LLM-driven clip planning.`)
    }

    if (clips.some((clip) => rangesOverlap(clip.sourceRange, candidate.sourceRange))) {
      throw new Error(`Recap script segment ${segment.id} produced an overlapping LLM-selected clip.`)
    }

    const duration = roundSeconds(candidate.sourceRange[1] - candidate.sourceRange[0])

    clips.push({
      beatId: beat.id,
      duration,
      id: `clip-${String(clips.length + 1).padStart(3, '0')}`,
      reason: `LLM-selected sourceRange from script segment ${segment.id}: ${segment.visualGuidance}`,
      sceneId: beat.id,
      scriptSegmentId: segment.id,
      selectionReason: 'script-driven',
      selectionRank: segmentIndex + 1,
      source: sourceManifest.sourcePath,
      sourceRange: candidate.sourceRange,
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

function createScriptClipCandidate(
  segment: RecapScriptSegment,
  sourceDuration: number,
  remainingDuration: number,
): {sourceRange: [number, number]} | undefined {
  const sourceRange = normalizeSourceRange(segment.sourceRange, sourceDuration)
  const duration = roundSeconds(Math.min(sourceRange[1] - sourceRange[0], Math.max(0, segment.suggestedDuration), Math.max(0, remainingDuration)))

  if (duration <= 0) {
    return undefined
  }

  const sourceStart = sourceRange[0]
  const sourceEnd = roundSeconds(Math.min(sourceRange[1], sourceStart + duration))

  return sourceEnd <= sourceStart ? undefined : {sourceRange: [sourceStart, sourceEnd]}
}
