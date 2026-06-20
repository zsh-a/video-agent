import type {LongVideoSelectedMoments, MediaInfo, Slide, SlideTiming} from '@video-agent/ir'

import {DeckSchema, MediaInfoSchema, NarrationSchema, SpeakerScriptSchema, StoryboardSchema, TimedDeckSchema, TimelineSchema} from '@video-agent/ir'

import type {TextDeckProjectPlan} from './types.js'
import {createTextPlanQualityReport} from './text-plan-builder.js'
import {createDeckNarrationFromTimings, createTextTimeline, updateSelectedMomentsTiming, updateStoryboardTiming} from './timing.js'
import {roundSeconds} from '../shared/utils.js'

export function createAudioAnchoredDeckProjectPlan(plan: TextDeckProjectPlan, inputPath: string, sourceMediaInfo: MediaInfo, duration: number): TextDeckProjectPlan {
  const deck = DeckSchema.parse({
    ...plan.deck,
    inputMode: 'audio-anchored',
  })
  const speakerScript = SpeakerScriptSchema.parse({
    ...plan.speakerScript,
    mode: 'audio-anchored',
  })
  const timings = createSlideTimingsFromSelectedMoments(plan.selectedMoments, deck.slides, duration)
  const timedDeck = TimedDeckSchema.parse({
    audioRef: 'audio/deck_voiceover.wav',
    deck,
    timings,
    version: 1,
  })
  const narration = NarrationSchema.parse(createDeckNarrationFromTimings(speakerScript, timings))
  const storyboard = StoryboardSchema.parse(updateStoryboardTiming(plan.storyboard, narration, timings))
  const timeline = TimelineSchema.parse(createTextTimeline(duration))
  const selectedMoments = updateSelectedMomentsTiming(plan.selectedMoments, timings)
  const mediaInfo = MediaInfoSchema.parse({
    ...sourceMediaInfo,
    duration,
    probedAt: new Date().toISOString(),
    version: 1,
  })
  const qualityReport = createTextPlanQualityReport({
    mediaInfo,
    narration,
    selectedMoments,
    storyboard,
    timeline,
  })

  return {
    ...plan,
    deck,
    mediaInfo,
    narration,
    qualityReport,
    selectedMoments,
    speakerScript,
    storyboard,
    timedDeck,
    timeline,
  }
}

function createSlideTimingsFromSelectedMoments(selectedMoments: LongVideoSelectedMoments, slides: Slide[], duration: number): SlideTiming[] {
  if (selectedMoments.moments.length !== slides.length) {
    throw new Error(`Deck audio anchoring requires one LLM-authored sourceRange per slide; got ${selectedMoments.moments.length} ranges for ${slides.length} slides.`)
  }

  const timings = selectedMoments.moments.map((moment, index): SlideTiming => {
    const slide = slides[index]
    const [start, end] = moment.sourceRange

    if (slide === undefined) {
      throw new Error(`Deck audio anchoring expected slide ${index + 1} for LLM-authored sourceRange.`)
    }

    assertSelectedMomentTargetsSlide(moment, slide, index)

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(`Deck audio anchoring sourceRange ${index + 1} must have a positive duration.`)
    }

    if (end > duration) {
      throw new Error(`Deck audio anchoring sourceRange ${index + 1} exceeds source audio duration; no runtime sourceRange clipping is allowed.`)
    }

    return {
      end: roundSeconds(end),
      slideId: slide.slideId,
      start: roundSeconds(start),
    }
  })

  assertContiguousAudioRanges(timings, duration)

  return timings
}

function assertSelectedMomentTargetsSlide(moment: LongVideoSelectedMoments['moments'][number], slide: Slide, index: number): void {
  const expectedRefSuffix = `#${slide.slideId}`
  const hasSlideEvidenceRef = moment.evidence.some((evidence) => evidence.ref.endsWith(expectedRefSuffix))

  if (!hasSlideEvidenceRef) {
    throw new Error(`Deck audio anchoring selected moment ${index + 1} does not reference slide "${slide.slideId}" evidence; no index-based selected-moment fallback is allowed.`)
  }
}

function assertContiguousAudioRanges(timings: SlideTiming[], duration: number): void {
  const tolerance = 0.05

  timings.forEach((timing, index) => {
    const expectedStart = index === 0 ? 0 : timings[index - 1]?.end

    if (expectedStart === undefined || Math.abs(timing.start - expectedStart) > tolerance) {
      throw new Error(`Deck audio anchoring sourceRange ${index + 1} must start where the previous slide range ends.`)
    }
  })

  const lastEnd = timings.at(-1)?.end

  if (lastEnd === undefined || Math.abs(lastEnd - duration) > tolerance) {
    throw new Error('Deck audio anchoring sourceRanges must cover the full source audio duration.')
  }
}
