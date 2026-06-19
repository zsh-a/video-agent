import type {Deck, LongVideoSelectedMoments, MediaInfo, SpeakerScript, Storyboard, TimedDeck} from '@video-agent/ir'
import type {TTSSegment} from '@video-agent/providers'

import {NarrationSchema, StoryboardSchema, TimedDeckSchema, TimelineSchema} from '@video-agent/ir'

import {createTextQualityIssues, summarizeQualityIssues} from './deck-quality.js'
import {createDeckNarrationFromTimings, createSlideTimingsFromTts, createTextTimeline, updateSelectedMomentsTiming, updateStoryboardTiming} from './deck-timing.js'
import type {DeckVoiceover} from './deck-voiceover-types.js'

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
    segments: input.ttsSegments.map((segment, index) => {
      const timing = timings[index]

      return {
        duration: timing === undefined ? segment.duration : timing.end - timing.start,
        narrationId: segment.narrationId,
        path: segment.path,
        slideId: input.speakerScript.segments[index]?.slideId ?? `slide-${String(index + 1).padStart(3, '0')}`,
        start: timing?.start ?? 0,
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
    timedDeck,
    timeline,
    totalDuration,
  }
}
