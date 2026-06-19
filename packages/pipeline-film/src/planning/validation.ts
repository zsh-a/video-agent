import type {CharacterIndex, NarrativeBeats, RecapScript, RecapScriptSegment, SourceManifest, StoryIndex} from '@video-agent/ir'

import {CharacterIndexSchema, NarrativeBeatsSchema, StoryIndexSchema} from '@video-agent/ir'

import {defaultRecapTargetDuration} from './source.js'
import {clamp, roundSeconds} from '../shared/utils.js'

export function validateGeneratedStoryIndex(indexed: {characterIndex: unknown; narrativeBeats: unknown; storyIndex: unknown}, sourceManifest: SourceManifest): {
  characterIndex: CharacterIndex
  narrativeBeats: NarrativeBeats
  storyIndex: StoryIndex
} {
  const narrativeBeats = NarrativeBeatsSchema.parse(indexed.narrativeBeats)
  const characterIndex = CharacterIndexSchema.parse(indexed.characterIndex)
  const storyIndex = StoryIndexSchema.parse(indexed.storyIndex)
  const beatIds = narrativeBeats.beats.map((beat) => beat.id)
  const storyBeatIds = storyIndex.beats.map((beat) => beat.id)

  if (beatIds.length === 0) {
    throw new Error('Film Recap story-index provider returned no narrative beats.')
  }

  if (beatIds.join('\u0000') !== storyBeatIds.join('\u0000')) {
    throw new Error('Film Recap story-index provider returned mismatched narrativeBeats and storyIndex beat ids.')
  }

  for (const beat of storyIndex.beats) {
    const sourceRange = normalizeSourceRange(beat.sourceRange, sourceManifest.duration)

    if (sourceRange[1] <= sourceRange[0]) {
      throw new Error(`Story-index beat ${beat.id} must have a positive sourceRange.`)
    }
  }

  if (storyIndex.source !== sourceManifest.sourcePath || storyIndex.sourceDuration !== sourceManifest.duration) {
    throw new Error('Film Recap story-index provider returned source metadata that does not match source-manifest.json.')
  }

  return {characterIndex, narrativeBeats, storyIndex}
}

export function validateGeneratedRecapScript(recapScript: RecapScript, storyIndex: StoryIndex, sourceManifest: SourceManifest, targetDurationSeconds: number | undefined): RecapScript {
  const beatIds = new Set(storyIndex.beats.map((beat) => beat.id))
  const expectedDuration = clamp(targetDurationSeconds ?? defaultRecapTargetDuration(sourceManifest.duration), 0, sourceManifest.duration)
  const normalizedSegments: RecapScriptSegment[] = []

  if (recapScript.segments.length === 0) {
    throw new Error('Film Recap script provider returned no segments.')
  }

  for (const segment of recapScript.segments) {
    if (segment.targetBeatIds.length === 0) {
      throw new Error(`Recap script segment ${segment.id} must reference at least one story-index beat.`)
    }

    for (const beatId of segment.targetBeatIds) {
      if (!beatIds.has(beatId)) {
        throw new Error(`Recap script segment ${segment.id} references unknown story-index beat ${beatId}.`)
      }
    }

    if (segment.suggestedDuration <= 0) {
      throw new Error(`Recap script segment ${segment.id} must have a positive suggestedDuration.`)
    }

    const sourceRange = normalizeSourceRange(segment.sourceRange, sourceManifest.duration)

    if (sourceRange[1] <= sourceRange[0]) {
      throw new Error(`Recap script segment ${segment.id} must provide a positive sourceRange.`)
    }

    normalizedSegments.push({
      ...segment,
      sourceRange: [roundSeconds(sourceRange[0]), roundSeconds(sourceRange[1])],
    })
  }

  return normalizeRecapScriptDurations({
    ...recapScript,
    segments: normalizedSegments,
  }, expectedDuration)
}

function normalizeRecapScriptDurations(recapScript: RecapScript, targetDuration: number): RecapScript {
  const currentDuration = recapScript.segments.reduce((total, segment) => total + Math.max(0, segment.suggestedDuration), 0)

  if (targetDuration <= 0 || currentDuration <= 0) {
    return {
      ...recapScript,
      totalEstimatedDuration: roundSeconds(currentDuration),
    }
  }

  const scale = targetDuration / currentDuration
  const segments = recapScript.segments.map((segment) => ({
    ...segment,
    suggestedDuration: roundSeconds(segment.suggestedDuration * scale),
  }))
  const durationDelta = roundSeconds(targetDuration - segments.reduce((total, segment) => total + segment.suggestedDuration, 0))
  const lastSegment = segments.at(-1)

  if (lastSegment !== undefined && Math.abs(durationDelta) >= 0.001) {
    lastSegment.suggestedDuration = roundSeconds(Math.max(0.001, lastSegment.suggestedDuration + durationDelta))
  }

  return {
    ...recapScript,
    segments,
    totalEstimatedDuration: roundSeconds(segments.reduce((total, segment) => total + segment.suggestedDuration, 0)),
  }
}

export function normalizeSourceRange(range: [number, number], sourceDuration: number): [number, number] {
  const start = clamp(range[0], 0, sourceDuration)
  const end = clamp(range[1], start, sourceDuration)

  return [start, end]
}
