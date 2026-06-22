import type {DeckTimingDriftReport, LongVideoSelectedMoments, MediaInfo, Narration, Storyboard, TimedDeck, Timeline} from '@video-agent/ir'
import type {Transcript, TTSSegment} from '@video-agent/providers'
import type {ProjectWorkspace} from '@video-agent/runtime'

import {CLAIMS_ARTIFACT_NAME, CONTENT_ANALYSIS_ARTIFACT_NAME, CONTENT_BLOCKS_ARTIFACT_NAME, DECK_ARTIFACT_NAME, DECK_BRIEF_ARTIFACT_NAME, DECK_COHERENCE_REPORT_ARTIFACT_NAME, DECK_COVERAGE_REPORT_ARTIFACT_NAME, DECK_TIMING_REPORT_ARTIFACT_NAME, DECK_VOICEOVER_ARTIFACT_NAME, DOCUMENT_ARTIFACT_NAME, MEDIA_INFO_ARTIFACT_NAME, NARRATION_ARTIFACT_NAME, OUTLINE_ARTIFACT_NAME, QUALITY_REPORT_ARTIFACT_NAME, SCRIPT_TIMING_REPORT_ARTIFACT_NAME, SELECTED_MOMENTS_ARTIFACT_NAME, SLIDE_OUTLINE_ARTIFACT_NAME, SOURCE_MAP_ARTIFACT_NAME, SOURCE_QUOTES_ARTIFACT_NAME, SPEAKER_SCRIPT_ARTIFACT_NAME, STORYBOARD_ARTIFACT_NAME, TIMED_DECK_ARTIFACT_NAME, TIMELINE_ARTIFACT_NAME, TRANSCRIPT_ARTIFACT_NAME, TTS_SEGMENTS_ARTIFACT_NAME} from '@video-agent/runtime'

import type {TextDeckProjectPlan} from '../planning/index.js'
import type {DeckVoiceover} from './voiceover-types.js'

export interface DeckTextPlanArtifacts {
  coherenceReport: string
  contentBlocks: string
  contentAnalysis: string
  coverageReport: string
  claims: string
  deckBrief: string
  deck: string
  document: string
  llmTrace?: string
  mediaInfo: string
  narration: string
  outline: string
  qualityReport: string
  selectedMoments: string
  scriptTimingReport: string
  slideOutline: string
  speakerScript: string
  sourceMap: string
  sourceQuotes: string
  storyboard: string
  timedDeck: string
  timeline: string
}

export interface DeckAudioSummaryPlanArtifacts extends DeckTextPlanArtifacts {
  transcript: string
}

export interface DeckAudioAnchoredPlanArtifacts extends DeckAudioSummaryPlanArtifacts {
  deckVoiceover: string
}

export interface DeckVoiceoverProjectArtifacts {
  deckVoiceover: string
  llmTrace?: string
  mediaInfo: string
  narration: string
  qualityReport: string
  selectedMoments: string
  storyboard: string
  timingDriftReport: string
  timedDeck: string
  timeline: string
  ttsSegments: string
}

export async function writeDeckTextPlanArtifacts(
  workspace: ProjectWorkspace,
  plan: TextDeckProjectPlan,
  llmTracePath: string | undefined,
): Promise<DeckTextPlanArtifacts> {
  return {
    sourceMap: await workspace.store.writeJson(SOURCE_MAP_ARTIFACT_NAME, plan.sourceMap),
    contentAnalysis: await workspace.store.writeJson(CONTENT_ANALYSIS_ARTIFACT_NAME, plan.contentAnalysis),
    deckBrief: await workspace.store.writeJson(DECK_BRIEF_ARTIFACT_NAME, plan.deckBrief),
    slideOutline: await workspace.store.writeJson(SLIDE_OUTLINE_ARTIFACT_NAME, plan.slideOutline),
    coherenceReport: await workspace.store.writeJson(DECK_COHERENCE_REPORT_ARTIFACT_NAME, plan.coherenceReport),
    coverageReport: await workspace.store.writeJson(DECK_COVERAGE_REPORT_ARTIFACT_NAME, plan.coverageReport),
    document: await workspace.store.writeJson(DOCUMENT_ARTIFACT_NAME, plan.document),
    contentBlocks: await workspace.store.writeJson(CONTENT_BLOCKS_ARTIFACT_NAME, plan.contentBlocks),
    claims: await workspace.store.writeJson(CLAIMS_ARTIFACT_NAME, plan.claims),
    sourceQuotes: await workspace.store.writeJson(SOURCE_QUOTES_ARTIFACT_NAME, plan.sourceQuotes),
    outline: await workspace.store.writeJson(OUTLINE_ARTIFACT_NAME, plan.outline),
    deck: await workspace.store.writeJson(DECK_ARTIFACT_NAME, plan.deck),
    speakerScript: await workspace.store.writeJson(SPEAKER_SCRIPT_ARTIFACT_NAME, plan.speakerScript),
    scriptTimingReport: await workspace.store.writeJson(SCRIPT_TIMING_REPORT_ARTIFACT_NAME, plan.scriptTimingReport),
    timedDeck: await workspace.store.writeJson(TIMED_DECK_ARTIFACT_NAME, plan.timedDeck),
    mediaInfo: await workspace.store.writeJson(MEDIA_INFO_ARTIFACT_NAME, plan.mediaInfo),
    selectedMoments: await workspace.store.writeJson(SELECTED_MOMENTS_ARTIFACT_NAME, plan.selectedMoments),
    storyboard: await workspace.store.writeJson(STORYBOARD_ARTIFACT_NAME, plan.storyboard),
    timeline: await workspace.store.writeJson(TIMELINE_ARTIFACT_NAME, plan.timeline),
    narration: await workspace.store.writeJson(NARRATION_ARTIFACT_NAME, plan.narration),
    qualityReport: await workspace.store.writeJson(QUALITY_REPORT_ARTIFACT_NAME, plan.qualityReport),
    ...(llmTracePath === undefined ? {} : {llmTrace: llmTracePath}),
  }
}

export async function writeDeckAudioSummaryPlanArtifacts(
  workspace: ProjectWorkspace,
  transcript: Transcript,
  plan: TextDeckProjectPlan,
  llmTracePath: string | undefined,
): Promise<DeckAudioSummaryPlanArtifacts> {
  return {
    transcript: await workspace.store.writeJson(TRANSCRIPT_ARTIFACT_NAME, transcript),
    ...await writeDeckTextPlanArtifacts(workspace, plan, llmTracePath),
  }
}

export async function writeDeckAudioAnchoredPlanArtifacts(
  workspace: ProjectWorkspace,
  transcript: Transcript,
  plan: TextDeckProjectPlan,
  deckVoiceover: DeckVoiceover,
  llmTracePath: string | undefined,
): Promise<DeckAudioAnchoredPlanArtifacts> {
  return {
    transcript: await workspace.store.writeJson(TRANSCRIPT_ARTIFACT_NAME, transcript),
    deckVoiceover: await workspace.store.writeJson(DECK_VOICEOVER_ARTIFACT_NAME, deckVoiceover),
    ...await writeDeckTextPlanArtifacts(workspace, plan, llmTracePath),
  }
}

export async function writeDeckVoiceoverProjectArtifacts(workspace: ProjectWorkspace, input: {
  deckVoiceover: DeckVoiceover
  llmTracePath?: string
  mediaInfo: MediaInfo
  narration: Narration
  qualityReport: unknown
  selectedMoments: LongVideoSelectedMoments
  storyboard: Storyboard
  timingDriftReport: DeckTimingDriftReport
  timedDeck: TimedDeck
  timeline: Timeline
  ttsSegments: TTSSegment[]
}): Promise<DeckVoiceoverProjectArtifacts> {
  return {
    ttsSegments: await workspace.store.writeJson(TTS_SEGMENTS_ARTIFACT_NAME, input.ttsSegments),
    deckVoiceover: await workspace.store.writeJson(DECK_VOICEOVER_ARTIFACT_NAME, input.deckVoiceover),
    timingDriftReport: await workspace.store.writeJson(DECK_TIMING_REPORT_ARTIFACT_NAME, input.timingDriftReport),
    timedDeck: await workspace.store.writeJson(TIMED_DECK_ARTIFACT_NAME, input.timedDeck),
    mediaInfo: await workspace.store.writeJson(MEDIA_INFO_ARTIFACT_NAME, input.mediaInfo),
    selectedMoments: await workspace.store.writeJson(SELECTED_MOMENTS_ARTIFACT_NAME, input.selectedMoments),
    storyboard: await workspace.store.writeJson(STORYBOARD_ARTIFACT_NAME, input.storyboard),
    timeline: await workspace.store.writeJson(TIMELINE_ARTIFACT_NAME, input.timeline),
    narration: await workspace.store.writeJson(NARRATION_ARTIFACT_NAME, input.narration),
    qualityReport: await workspace.store.writeJson(QUALITY_REPORT_ARTIFACT_NAME, input.qualityReport),
    ...(input.llmTracePath === undefined ? {} : {llmTrace: input.llmTracePath}),
  }
}
