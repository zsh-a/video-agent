import type {CharacterIndex, NarrativeBeats, RecapScript, RecapScriptSegment, SourceManifest, StoryIndex} from '@video-agent/ir'

import {CharacterIndexSchema, NarrativeBeatsSchema, StoryIndexSchema} from '@video-agent/ir'

import {roundSeconds} from '../shared/utils.js'

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
    requireProviderSourceRange(beat.sourceRange, sourceManifest.duration, `Story-index beat ${beat.id}`)
  }

  if (storyIndex.source !== sourceManifest.sourcePath || storyIndex.sourceDuration !== sourceManifest.duration) {
    throw new Error('Film Recap story-index provider returned source metadata that does not match source-manifest.json.')
  }

  return {characterIndex, narrativeBeats, storyIndex}
}

export function validateGeneratedRecapScript(recapScript: RecapScript, storyIndex: StoryIndex, sourceManifest: SourceManifest, targetDurationSeconds: number | undefined): RecapScript {
  const beatIds = new Set(storyIndex.beats.map((beat) => beat.id))
  const expectedDuration = targetDurationSeconds === undefined
    ? requireLLMRecapScriptTotalDuration(recapScript, sourceManifest.duration)
    : requireTargetDuration(targetDurationSeconds, sourceManifest.duration)
  const normalizedSegments: RecapScriptSegment[] = []

  if (recapScript.segments.length === 0) {
    throw new Error('Film Recap script provider returned no segments.')
  }

  for (const segment of recapScript.segments) {
    if (segment.targetBeatIds.length !== 1) {
      throw new Error(`Recap script segment ${segment.id} must reference exactly one story-index beat; no runtime beat selection fallback is allowed.`)
    }

    for (const beatId of segment.targetBeatIds) {
      if (!beatIds.has(beatId)) {
        throw new Error(`Recap script segment ${segment.id} references unknown story-index beat ${beatId}.`)
      }
    }

    if (segment.suggestedDuration <= 0) {
      throw new Error(`Recap script segment ${segment.id} must have a positive suggestedDuration.`)
    }

    if (segment.pauseAfterMs > 2000) {
      throw new Error(`Recap script segment ${segment.id} pauseAfterMs must be 2000ms or less; rewrite LLM recap script output instead of clamping locally.`)
    }

    const sourceRange = requireProviderSourceRange(segment.sourceRange, sourceManifest.duration, `Recap script segment ${segment.id}`)

    normalizedSegments.push({
      ...segment,
      sourceRange: [roundSeconds(sourceRange[0]), roundSeconds(sourceRange[1])],
    })
  }

  return validateRecapScriptDurations({
    ...recapScript,
    segments: normalizedSegments,
  }, expectedDuration)
}

function validateRecapScriptDurations(recapScript: RecapScript, targetDuration: number): RecapScript {
  const segments = recapScript.segments.map((segment) => {
    const sourceRangeDuration = roundSeconds(segment.sourceRange[1] - segment.sourceRange[0])
    const suggestedDuration = roundSeconds(segment.suggestedDuration)

    if (Math.abs(sourceRangeDuration - suggestedDuration) > 0.001) {
      throw new Error(`Recap script segment ${segment.id} suggestedDuration must match its LLM-authored sourceRange duration; no runtime clip truncation is allowed.`)
    }

    return {
      ...segment,
      suggestedDuration,
    }
  })
  const currentDuration = roundSeconds(segments.reduce((total, segment) => total + Math.max(0, segment.suggestedDuration), 0))
  const expectedDuration = roundSeconds(targetDuration)

  if (Math.abs(currentDuration - expectedDuration) > 0.001) {
    throw new Error(`Film Recap script provider returned target duration ${expectedDuration}s, but segment suggestedDuration values sum to ${currentDuration}s. Rewrite LLM recap script output instead of scaling locally.`)
  }

  return {
    ...recapScript,
    segments,
    totalEstimatedDuration: expectedDuration,
  }
}

function requireLLMRecapScriptTotalDuration(recapScript: RecapScript, sourceDuration: number): number {
  const totalEstimatedDuration = roundSeconds(recapScript.totalEstimatedDuration)

  if (totalEstimatedDuration <= 0) {
    throw new Error('Film Recap script provider must return a positive totalEstimatedDuration when no targetDurationSeconds is provided.')
  }

  if (sourceDuration > 0 && totalEstimatedDuration > sourceDuration) {
    throw new Error('Film Recap script provider returned totalEstimatedDuration beyond source duration.')
  }

  return totalEstimatedDuration
}

function requireTargetDuration(targetDurationSeconds: number, sourceDuration: number): number {
  const targetDuration = roundSeconds(targetDurationSeconds)

  if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
    throw new Error('Film Recap targetDurationSeconds must be positive; no runtime target duration clipping is allowed.')
  }

  if (sourceDuration > 0 && targetDuration > sourceDuration) {
    throw new Error('Film Recap targetDurationSeconds must not exceed source duration; no runtime target duration clipping is allowed.')
  }

  return targetDuration
}

export function requireProviderSourceRange(range: [number, number], sourceDuration: number, context: string): [number, number] {
  const [start, end] = range

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > sourceDuration || end <= start) {
    throw new Error(`${context} sourceRange must stay within source duration; no runtime sourceRange clipping is allowed.`)
  }

  return [roundSeconds(start), roundSeconds(end)]
}
