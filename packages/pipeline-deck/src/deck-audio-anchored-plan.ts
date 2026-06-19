import type {MediaInfo} from '@video-agent/ir'

import {DeckSchema, MediaInfoSchema, NarrationSchema, SpeakerScriptSchema, StoryboardSchema, TimedDeckSchema, TimelineSchema} from '@video-agent/ir'

import type {TextDeckProjectPlan} from './deck-plan-types.js'
import {createDeckSelectedMoments, createTextPlanQualityReport} from './deck-text-plan-builder.js'
import {createDeckNarrationFromTimings, createDeckStoryboard, createSlideTimingsWithinDuration, createTextTimeline} from './deck-timing.js'

export function createAudioAnchoredDeckProjectPlan(plan: TextDeckProjectPlan, inputPath: string, sourceMediaInfo: MediaInfo, duration: number, language: string, fallbackSlideSeconds: number): TextDeckProjectPlan {
  const deck = DeckSchema.parse({
    ...plan.deck,
    inputMode: 'audio-anchored',
    language,
  })
  const speakerScript = SpeakerScriptSchema.parse({
    ...plan.speakerScript,
    language,
    mode: 'audio-anchored',
  })
  const timings = createSlideTimingsWithinDuration(speakerScript, duration, fallbackSlideSeconds)
  const timedDeck = TimedDeckSchema.parse({
    audioRef: 'audio/deck_voiceover.wav',
    deck,
    timings,
    version: 1,
  })
  const narration = NarrationSchema.parse(createDeckNarrationFromTimings(speakerScript, timings))
  const storyboard = StoryboardSchema.parse(createDeckStoryboard(deck, speakerScript, timings, language))
  const timeline = TimelineSchema.parse(createTextTimeline(duration))
  const selectedMoments = createDeckSelectedMoments(inputPath, deck, speakerScript, timings, {
    chunkId: 'audio-000',
    idPrefix: 'audio-slide',
    reason: 'LLM-planned audio transcript section aligned to the source audio.',
  })
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
