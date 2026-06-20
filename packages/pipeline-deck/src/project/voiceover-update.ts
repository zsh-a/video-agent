import type {Deck, DeckTimingDriftReport, LongVideoSelectedMoments, MediaInfo, SpeakerScript, Storyboard, TimedDeck} from '@video-agent/ir'
import type {TTSSegment} from '@video-agent/providers'

import {NarrationSchema, StoryboardSchema, TimedDeckSchema, TimelineSchema} from '@video-agent/ir'

import {createTextQualityIssues, summarizeQualityIssues} from '../quality/report.js'
import {createDeckNarrationFromTimings, createSlideTimingsFromTts, createTextTimeline, deckNarrationIdForIndex, updateSelectedMomentsTiming, updateStoryboardTiming} from '../planning/timing.js'
import type {DeckVoiceover} from './voiceover-types.js'
import {assertDeckTimingDrift, createDeckTimingDriftReport} from '../quality/timing-drift.js'

export interface DeckVoiceoverUpdate {
  deckVoiceover: DeckVoiceover
  mediaInfo: MediaInfo
  narration: ReturnType<typeof NarrationSchema.parse>
  qualityReport: {
    checkedAt: string
    issues: ReturnType<typeof createTextQualityIssues>
    narrationSegments: number
    summary: ReturnType<typeof summarizeQualityIssues>
    ttsSegments: number
    version: 1
  }
  selectedMoments: LongVideoSelectedMoments
  storyboard: ReturnType<typeof StoryboardSchema.parse>
  timingDriftReport: DeckTimingDriftReport
  timedDeck: ReturnType<typeof TimedDeckSchema.parse>
  timeline: ReturnType<typeof TimelineSchema.parse>
  totalDuration: number
}

export function createDeckVoiceoverUpdate(input: {
  currentMediaInfo: MediaInfo
  currentSelectedMoments: LongVideoSelectedMoments
  currentStoryboard: Storyboard
  currentTimedDeck: TimedDeck
  deck: Deck
  speakerScript: SpeakerScript
  ttsSegments: TTSSegment[]
}): DeckVoiceoverUpdate {
  const timingDriftReport = createDeckTimingDriftReport({
    speakerScript: input.speakerScript,
    ttsSegments: input.ttsSegments,
  })

  assertDeckTimingDrift(timingDriftReport)

  const timings = createSlideTimingsFromTts(input.speakerScript, input.currentTimedDeck, input.ttsSegments)
  const totalDuration = timings.at(-1)?.end ?? 0
  const timedDeck = TimedDeckSchema.parse({
    audioRef: 'audio/deck_voiceover.wav',
    deck: input.deck,
    timings,
    version: 1,
  })
  const narration = NarrationSchema.parse(createDeckNarrationFromTimings(input.speakerScript, timings))
  const storyboard = StoryboardSchema.parse(updateStoryboardTiming(input.currentStoryboard, narration, timings))
  const timeline = TimelineSchema.parse(createTextTimeline(totalDuration))
  const selectedMoments = updateSelectedMomentsTiming(input.currentSelectedMoments, timings)
  const mediaInfo = {
    ...input.currentMediaInfo,
    duration: totalDuration,
    probedAt: new Date().toISOString(),
  }
  const issues = createTextQualityIssues({
    mediaInfo,
    narration,
    selectedMoments,
    storyboard,
    timeline,
  })
  const qualityReport = {
    checkedAt: new Date().toISOString(),
    issues,
    narrationSegments: narration.segments.length,
    summary: summarizeQualityIssues(issues),
    ttsSegments: input.ttsSegments.length,
    version: 1 as const,
  }
  const deckVoiceover = {
    duration: totalDuration,
    generatedAt: new Date().toISOString(),
    outputPath: 'audio/deck_voiceover.wav',
    segments: input.speakerScript.segments.map((segment, index) => {
      const narrationId = deckNarrationIdForIndex(index)
      const ttsSegment = input.ttsSegments.find((candidate) => candidate.narrationId === narrationId)
      const timing = timings[index]

      if (ttsSegment === undefined) {
        throw new Error(`Deck voiceover output is missing TTS segment for narrationId "${narrationId}".`)
      }

      if (timing === undefined || timing.slideId !== segment.slideId) {
        throw new Error(`Deck voiceover output is missing timing for slide "${segment.slideId}".`)
      }

      return {
        duration: timing.end - timing.start,
        narrationId: ttsSegment.narrationId,
        path: ttsSegment.path,
        slideId: segment.slideId,
        start: timing.start,
      }
    }),
    version: 1 as const,
  }

  return {
    deckVoiceover,
    mediaInfo,
    narration,
    qualityReport,
    selectedMoments,
    storyboard,
    timingDriftReport,
    timedDeck,
    timeline,
    totalDuration,
  }
}
