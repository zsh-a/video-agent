import type {LongVideoSelectedMoments, Narration, SlideTiming, SpeakerScript, Storyboard, TimedDeck, Timeline, Deck} from '@video-agent/ir'
import type {TTSSegment} from '@video-agent/providers'

import type {NormalizedLLMTextDeckSlide} from './llm-plan.js'
import {roundSeconds} from '../shared/utils.js'

export function createDeckNarrationFromSpeakerScript(speakerScript: SpeakerScript, timedDeck: TimedDeck): Narration {
  const timingBySlide = new Map(timedDeck.timings.map((timing) => [timing.slideId, timing]))

  return {
    language: speakerScript.language,
    segments: speakerScript.segments.map((segment, index) => {
      const timing = timingBySlide.get(segment.slideId)

      if (timing === undefined) {
        throw new Error(`Deck narration segment ${index + 1} references slide "${segment.slideId}" with no timing entry.`)
      }

      if (segment.estimatedDuration === undefined) {
        throw new Error(`Deck speaker script segment ${index + 1} for slide "${segment.slideId}" is missing LLM-authored estimatedDuration.`)
      }

      return {
        duration: segment.estimatedDuration,
        id: `narration-${index + 1}`,
        sceneId: `scene-${index + 1}`,
        start: timing.start,
        text: segment.text,
      }
    }),
    version: 1,
  }
}

export function createSlideTimingsFromTts(speakerScript: SpeakerScript, timedDeck: TimedDeck, ttsSegments: TTSSegment[]): SlideTiming[] {
  const ttsByNarrationId = indexTtsSegmentsByNarrationId(ttsSegments)
  const expectedNarrationIds = new Set(speakerScript.segments.map((_, index) => deckNarrationIdForIndex(index)))
  const extraNarrationIds = [...ttsByNarrationId.keys()].filter((narrationId) => !expectedNarrationIds.has(narrationId))

  if (extraNarrationIds.length > 0) {
    throw new Error(`Deck TTS output contains unexpected narrationId "${extraNarrationIds[0]}".`)
  }

  let cursor = 0

  return speakerScript.segments.map((segment, index) => {
    const narrationId = deckNarrationIdForIndex(index)
    const ttsSegment = ttsByNarrationId.get(narrationId)

    if (ttsSegment === undefined) {
      throw new Error(`Deck TTS output is missing narrationId "${narrationId}" for slide "${segment.slideId}".`)
    }

    if (ttsSegment.duration <= 0) {
      throw new Error(`Deck TTS output for narrationId "${narrationId}" must have a positive duration.`)
    }

    const expectedTiming = timedDeck.timings.find((timing) => timing.slideId === segment.slideId)

    if (expectedTiming === undefined) {
      throw new Error(`Deck TTS timing update expected existing timing for slide "${segment.slideId}".`)
    }

    const duration = roundSeconds(ttsSegment.duration)
    const start = roundSeconds(cursor)
    const end = roundSeconds(start + duration)

    cursor = end

    return {
      end,
      slideId: segment.slideId,
      start,
    }
  })
}

export function deckNarrationIdForIndex(index: number): string {
  return `narration-${index + 1}`
}

function indexTtsSegmentsByNarrationId(ttsSegments: TTSSegment[]): Map<string, TTSSegment> {
  const indexed = new Map<string, TTSSegment>()

  for (const segment of ttsSegments) {
    if (indexed.has(segment.narrationId)) {
      throw new Error(`Deck TTS output contains duplicate narrationId "${segment.narrationId}".`)
    }

    indexed.set(segment.narrationId, segment)
  }

  return indexed
}

export function createTextTimeline(duration: number): Timeline {
  return {
    duration,
    fps: 30,
    items: [],
    version: 1,
  }
}

export function createDeckNarrationFromTimings(speakerScript: SpeakerScript, timings: SlideTiming[]): Narration {
  const timingBySlide = new Map(timings.map((timing) => [timing.slideId, timing]))

  return {
    language: speakerScript.language,
    segments: speakerScript.segments.map((segment, index) => {
      const timing = timingBySlide.get(segment.slideId)

      if (timing === undefined) {
        throw new Error(`Deck narration segment ${index + 1} references slide "${segment.slideId}" with no timing entry.`)
      }

      return {
        duration: roundSeconds(timing.end - timing.start),
        id: `narration-${index + 1}`,
        sceneId: `scene-${index + 1}`,
        start: timing.start,
        text: segment.text,
      }
    }),
    version: 1,
  }
}

export function updateStoryboardTiming(storyboard: Storyboard, narration: Narration, timings: SlideTiming[]): Storyboard {
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene, index) => {
      const timing = timings[index]
      const narrationSegment = narration.segments[index]

      if (timing === undefined || narrationSegment === undefined) {
        throw new Error(`Deck storyboard scene ${index + 1} has no matching timing or narration segment.`)
      }

      return {
        ...scene,
        duration: roundSeconds(timing.end - timing.start),
        narration: narrationSegment.text,
        outputRange: [timing.start, timing.end],
        start: timing.start,
      }
    }),
  }
}

export function updateSelectedMomentsTiming(selectedMoments: LongVideoSelectedMoments, timings: SlideTiming[]): LongVideoSelectedMoments {
  return {
    ...selectedMoments,
    moments: selectedMoments.moments.map((moment, index) => {
      const timing = timings[index]

      if (timing === undefined) {
        throw new Error(`Deck selected moment ${index + 1} has no matching timing entry.`)
      }

      return {
        ...moment,
        outputRange: [timing.start, timing.end],
      }
    }),
  }
}

export function createDeckStoryboard(deck: Deck, timings: SlideTiming[], language: string, targetPlatform: Storyboard['targetPlatform'], slides: NormalizedLLMTextDeckSlide[]): Storyboard {
  return {
    language,
    scenes: deck.slides.map((slide, index) => {
      const timing = timings[index]
      const semantic = slides[index]?.semantic

      if (timing === undefined || timing.slideId !== slide.slideId) {
        throw new Error(`Deck storyboard expected timing ${index + 1} for slide "${slide.slideId}".`)
      }

      if (semantic === undefined) {
        throw new Error(`LLM Deck plan slide ${index + 1} is missing semantic metadata.`)
      }

      const duration = roundSeconds(timing.end - timing.start)

      if (duration <= 0) {
        throw new Error(`Deck storyboard scene ${index + 1} for slide "${slide.slideId}" must have a positive LLM-authored duration; no runtime duration fallback is allowed.`)
      }

      return {
        duration,
        evidence: slide.evidence,
        id: `scene-${index + 1}`,
        narration: semantic.momentSummary,
        sourceRange: requireLLMSlide(slides, index).sourceRange,
        start: timing.start,
        visualStyle: semantic.visualStyle,
      }
    }),
    targetPlatform,
    version: 1,
  }
}

function requireLLMSlide(slides: NormalizedLLMTextDeckSlide[], index: number): NormalizedLLMTextDeckSlide {
  const slide = slides[index]

  if (slide === undefined) {
    throw new Error(`LLM Deck plan is missing slide ${index + 1}.`)
  }

  return slide
}

export function createSlideTimingsFromSpeakerScript(speakerScript: SpeakerScript, durationTargetSeconds: number | undefined): SlideTiming[] {
  if (speakerScript.segments.length === 0) {
    throw new Error('Deck speaker script must contain at least one segment for timing.')
  }

  const durations = speakerScript.segments.map((segment, index) => requireEstimatedDuration(segment, index))
  const totalDuration = roundSeconds(durations.reduce((sum, duration) => sum + duration, 0))

  if (durationTargetSeconds !== undefined && Math.abs(totalDuration - durationTargetSeconds) > 0.05) {
    throw new Error(`Deck LLM speaker script durations total ${totalDuration}s, but target duration is ${roundSeconds(durationTargetSeconds)}s. Rewrite LLM Deck plan durations instead of scaling locally.`)
  }

  let cursor = 0

  return speakerScript.segments.map((segment, index) => {
    const duration = roundSeconds(requireDurationAt(durations, index, segment.slideId))
    const start = roundSeconds(cursor)
    const end = roundSeconds(start + duration)

    cursor = end

    return {
      end,
      slideId: segment.slideId,
      start,
    }
  })
}

function requireDurationAt(durations: number[], index: number, slideId: string): number {
  const duration = durations[index]

  if (duration === undefined) {
    throw new Error(`Deck speaker script segment ${index + 1} for slide "${slideId}" has no resolved duration; no runtime slide duration fallback is allowed.`)
  }

  return duration
}

function requireEstimatedDuration(segment: SpeakerScript['segments'][number], index: number): number {
  if (segment.estimatedDuration === undefined) {
    throw new Error(`Deck speaker script segment ${index + 1} for slide "${segment.slideId}" is missing LLM-authored estimatedDuration.`)
  }

  if (!Number.isFinite(segment.estimatedDuration) || segment.estimatedDuration <= 0) {
    throw new Error(`Deck speaker script segment ${index + 1} for slide "${segment.slideId}" must include a positive LLM-authored estimatedDuration; no runtime slide duration fallback is allowed.`)
  }

  return segment.estimatedDuration
}
