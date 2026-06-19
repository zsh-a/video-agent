import type {LongVideoSelectedMoments, Narration, SlideTiming, SpeakerScript, Storyboard, TimedDeck, Timeline, Deck} from '@video-agent/ir'
import type {TTSSegment} from '@video-agent/providers'

import {roundSeconds} from './deck-utils.js'

export function createDeckNarrationFromSpeakerScript(speakerScript: SpeakerScript, timedDeck: TimedDeck): Narration {
  const timingBySlide = new Map(timedDeck.timings.map((timing) => [timing.slideId, timing]))

  return {
    language: speakerScript.language,
    segments: speakerScript.segments.map((segment, index) => {
      const timing = timingBySlide.get(segment.slideId)

      return {
        duration: segment.estimatedDuration ?? (timing === undefined ? 1 : Math.max(0.1, timing.end - timing.start)),
        id: `narration-${index + 1}`,
        sceneId: `scene-${index + 1}`,
        start: timing?.start ?? index,
        text: segment.text,
      }
    }),
    version: 1,
  }
}

export function createSlideTimingsFromTts(speakerScript: SpeakerScript, timedDeck: TimedDeck, ttsSegments: TTSSegment[]): SlideTiming[] {
  let cursor = 0

  return speakerScript.segments.map((segment, index) => {
    const fallbackTiming = timedDeck.timings.find((timing) => timing.slideId === segment.slideId)
    const fallbackDuration = segment.estimatedDuration ?? (fallbackTiming === undefined ? 1 : fallbackTiming.end - fallbackTiming.start)
    const duration = roundSeconds(Math.max(0.1, ttsSegments[index]?.duration ?? fallbackDuration))
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

      return {
        duration: timing === undefined ? segment.estimatedDuration ?? 1 : roundSeconds(timing.end - timing.start),
        id: `narration-${index + 1}`,
        sceneId: `scene-${index + 1}`,
        start: timing?.start ?? index,
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

      if (timing === undefined) {
        return scene
      }

      return {
        ...scene,
        duration: roundSeconds(timing.end - timing.start),
        narration: narrationSegment?.text ?? scene.narration,
        sourceRange: [timing.start, timing.end],
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

      return timing === undefined ? moment : {
        ...moment,
        sourceRange: [timing.start, timing.end],
      }
    }),
  }
}

export function createDeckStoryboard(deck: Deck, speakerScript: SpeakerScript, timings: SlideTiming[], language: string): Storyboard {
  return {
    language,
    scenes: deck.slides.map((slide, index) => {
      const timing = timings[index] ?? {end: index + 1, slideId: slide.slideId, start: index}
      const script = speakerScript.segments[index]

      return {
        duration: Math.max(0.001, roundSeconds(timing.end - timing.start)),
        evidence: slide.evidence,
        id: `scene-${index + 1}`,
        narration: script?.text ?? slide.speakerNote ?? slide.title,
        sourceRange: [timing.start, timing.end] as [number, number],
        start: timing.start,
        visualStyle: 'slide_explainer',
      }
    }),
    targetPlatform: 'generic',
    version: 1,
  }
}

export function createSlideTimingsFromSpeakerScript(speakerScript: SpeakerScript, durationTargetSeconds: number | undefined, fallbackSlideSeconds: number): SlideTiming[] {
  const segmentCount = Math.max(1, speakerScript.segments.length)
  const targetDuration = durationTargetSeconds === undefined ? undefined : Math.max(segmentCount * 2, durationTargetSeconds)
  let cursor = 0

  return speakerScript.segments.map((segment) => {
    const duration = targetDuration === undefined
      ? Math.max(2, segment.estimatedDuration ?? fallbackSlideSeconds)
      : targetDuration / segmentCount
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

export function createSlideTimingsWithinDuration(speakerScript: SpeakerScript, duration: number, fallbackSlideSeconds: number): SlideTiming[] {
  const segmentCount = Math.max(1, speakerScript.segments.length)
  const totalDuration = roundSeconds(Math.max(0.1, duration))
  const weights = speakerScript.segments.map((segment) => Math.max(0.1, segment.estimatedDuration ?? fallbackSlideSeconds))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0

  return speakerScript.segments.map((segment, index) => {
    const start = roundSeconds(cursor)
    const end = index === segmentCount - 1
      ? totalDuration
      : roundSeconds(Math.min(totalDuration, cursor + totalDuration * weights[index] / totalWeight))

    cursor = end

    return {
      end: Math.max(start + 0.001, end),
      slideId: segment.slideId,
      start,
    }
  })
}
