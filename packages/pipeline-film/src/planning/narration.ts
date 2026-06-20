import type {ASRResult, ASRSegment, ClipPlan, Narration, OutputNarration, OutputTimelineMap, RecapScript, RecapScriptSegment, StoryIndex} from '@video-agent/ir'

import {rangeOverlapSeconds, roundSeconds} from '../shared/utils.js'

export function createOutputNarration(clipPlan: ClipPlan, outputTimelineMap: OutputTimelineMap, storyIndex: StoryIndex, asrResult: ASRResult | undefined, language: string, recapScript: RecapScript): OutputNarration {
  const beatsById = new Map(storyIndex.beats.map((beat) => [beat.id, beat]))
  const clipsById = new Map(clipPlan.clips.map((clip) => [clip.id, clip]))
  const scriptSegmentsById = new Map(recapScript.segments.map((segment) => [segment.id, segment]))

  return {
    language,
    segments: outputTimelineMap.clips.map((mappedClip, index) => {
      const clip = clipsById.get(mappedClip.clipId)

      if (clip === undefined) {
        throw new Error(`Output timeline references unknown clip ${mappedClip.clipId}.`)
      }

      if (clip.scriptSegmentId === undefined) {
        throw new Error(`Clip ${clip.id} is not script-driven; every Film Recap narration segment must reference recap-script.json.`)
      }

      const beat = clip.beatId === undefined ? undefined : beatsById.get(clip.beatId)
      const scriptSegment = scriptSegmentsById.get(clip.scriptSegmentId)

      if (scriptSegment === undefined) {
        throw new Error(`Clip ${clip.id} references missing recap script segment ${clip.scriptSegmentId}.`)
      }

      const start = roundSeconds(mappedClip.outputStart)
      const end = roundSeconds(mappedClip.outputEnd)
      const beatRef = beat?.id ?? clip.sceneId ?? mappedClip.clipId
      const clipSourceRange = [mappedClip.sourceStart, mappedClip.sourceEnd] as [number, number]
      const asrSegments = collectAsrSegmentsForRange(asrResult, clipSourceRange)
      const text = createScriptNarrationText(scriptSegment, index, language)

      return {
        end,
        evidence: [
          beatRef,
          mappedClip.clipId,
          `recap-script.json#${scriptSegment.id}`,
          ...asrSegments.map((segment) => `asr-result.json#${segment.id}`),
        ],
        id: `output-narration-${String(index + 1).padStart(3, '0')}`,
        overlapsSpeech: scriptSegment.overlapsSpeech,
        pauseAfterMs: scriptSegment.pauseAfterMs,
        scriptSegmentId: scriptSegment.id,
        source: 'script' as const,
        start,
        text,
      }
    }),
    timeline: 'output',
    version: 1,
  }
}

export function createCompatibleNarration(outputNarration: OutputNarration): Narration {
  return {
    language: outputNarration.language,
    segments: outputNarration.segments.map((segment) => ({
      duration: roundSeconds(segment.end - segment.start),
      id: segment.id,
      sceneId: segment.evidence[0],
      start: segment.start,
      text: segment.text,
    })),
    version: 1,
  }
}

function createScriptNarrationText(scriptSegment: RecapScriptSegment, index: number, language: string): string {
  const text = cleanNarrationText(scriptSegment.narrationText, language)

  if (text === '') {
    throw new Error(`Recap script segment ${scriptSegment.id} has no valid ${language} narration text for output segment ${index + 1}.`)
  }

  return text
}

function cleanNarrationText(text: string, language: string): string {
  if (text.trim() === '') {
    throw new Error(`Recap script narrationText is empty for ${language}; no runtime narration text fallback is allowed.`)
  }

  if (text !== text.trim()) {
    throw new Error('Recap script narrationText contains leading or trailing whitespace. Rewrite recap-script.json in LLM output; no runtime narration whitespace cleanup is allowed.')
  }

  if (/\s{2,}|\r|\n|\t/u.test(text)) {
    throw new Error('Recap script narrationText contains layout or repeated whitespace. Rewrite recap-script.json in LLM output; no runtime narration whitespace cleanup is allowed.')
  }

  if (/^第\s*\d+\s*段\s*[，,.:：、-]?/u.test(text)) {
    throw new Error('Recap script narrationText contains a segment-label prefix. Rewrite recap-script.json in LLM output; no runtime narration label cleanup is allowed.')
  }

  return text
}

function collectAsrSegmentsForRange(asrResult: ASRResult | undefined, sourceRange: [number, number]): ASRSegment[] {
  if (asrResult === undefined || asrResult.timestampConfidence === 'untimed') {
    return []
  }

  return asrResult.segments
    .filter((segment) => {
      const overlap = rangeOverlapSeconds([segment.start, segment.end], sourceRange)

      return overlap > 0.05 && overlap >= Math.min(segment.end - segment.start, sourceRange[1] - sourceRange[0]) * 0.5
    })
    .sort((left, right) => left.start - right.start || left.end - right.end)
}
