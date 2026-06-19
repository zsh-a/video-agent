import type {LongVideoSelectedMoments, MediaInfo, Narration, Storyboard, TimedDeck, Timeline} from '@video-agent/ir'
import type {Transcript, TTSSegment} from '@video-agent/providers'
import type {ProjectWorkspace} from '@video-agent/runtime'

import type {TextDeckProjectPlan} from '../planning/index.js'
import type {DeckVoiceover} from './voiceover-types.js'

export interface DeckTextPlanArtifacts {
  contentBlocks: string
  claims: string
  deck: string
  document: string
  llmTrace?: string
  mediaInfo: string
  narration: string
  outline: string
  qualityReport: string
  selectedMoments: string
  speakerScript: string
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
    document: await workspace.store.writeJson('document.json', plan.document),
    contentBlocks: await workspace.store.writeJson('content-blocks.json', plan.contentBlocks),
    claims: await workspace.store.writeJson('claims.json', plan.claims),
    sourceQuotes: await workspace.store.writeJson('source-quotes.json', plan.sourceQuotes),
    outline: await workspace.store.writeJson('outline.json', plan.outline),
    deck: await workspace.store.writeJson('deck.json', plan.deck),
    speakerScript: await workspace.store.writeJson('speaker-script.json', plan.speakerScript),
    timedDeck: await workspace.store.writeJson('timed-deck.json', plan.timedDeck),
    mediaInfo: await workspace.store.writeJson('media-info.json', plan.mediaInfo),
    selectedMoments: await workspace.store.writeJson('selected-moments.json', plan.selectedMoments),
    storyboard: await workspace.store.writeJson('storyboard.json', plan.storyboard),
    timeline: await workspace.store.writeJson('timeline.json', plan.timeline),
    narration: await workspace.store.writeJson('narration.json', plan.narration),
    qualityReport: await workspace.store.writeJson('quality-report.json', plan.qualityReport),
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
    transcript: await workspace.store.writeJson('transcript.json', transcript),
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
    transcript: await workspace.store.writeJson('transcript.json', transcript),
    deckVoiceover: await workspace.store.writeJson('deck-voiceover.json', deckVoiceover),
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
  timedDeck: TimedDeck
  timeline: Timeline
  ttsSegments: TTSSegment[]
}): Promise<DeckVoiceoverProjectArtifacts> {
  return {
    ttsSegments: await workspace.store.writeJson('tts-segments.json', input.ttsSegments),
    deckVoiceover: await workspace.store.writeJson('deck-voiceover.json', input.deckVoiceover),
    timedDeck: await workspace.store.writeJson('timed-deck.json', input.timedDeck),
    mediaInfo: await workspace.store.writeJson('media-info.json', input.mediaInfo),
    selectedMoments: await workspace.store.writeJson('selected-moments.json', input.selectedMoments),
    storyboard: await workspace.store.writeJson('storyboard.json', input.storyboard),
    timeline: await workspace.store.writeJson('timeline.json', input.timeline),
    narration: await workspace.store.writeJson('narration.json', input.narration),
    qualityReport: await workspace.store.writeJson('quality-report.json', input.qualityReport),
    ...(input.llmTracePath === undefined ? {} : {llmTrace: input.llmTracePath}),
  }
}
