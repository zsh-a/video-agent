import type {DeckContentDensity, DeckFormat, DeckSlideType, Document} from '@video-agent/ir'
import type {LLMClient} from '@video-agent/llm'

import type {
  DeckAudioAnchoredPlanArtifacts,
  DeckAudioSummaryPlanArtifacts,
  DeckTextPlanArtifacts,
  DeckVoiceoverProjectArtifacts,
} from './artifacts.js'

export interface CreateDeckExplainerProjectOptions {
  contentDensity?: DeckContentDensity
  deckFormat?: DeckFormat
  durationTargetSeconds?: number
  inputPath: string
  language?: string
  llmClient?: LLMClient
  maxSlideCharacters?: number
  mode?: 'script-generated'
  projectId?: string
  requiredSlideTypes?: DeckSlideType[]
  sourceType?: Exclude<Document['source']['sourceType'], 'audio'>
  theme?: string
  title?: string
  trace?: boolean
  workspaceDir?: string
}

export interface CreateDeckExplainerProjectResult {
  artifacts: DeckTextPlanArtifacts
  projectDir: string
  projectId: string
  slides: number
  status: 'completed'
}

export interface CreateDeckVoiceoverProjectOptions {
  projectId: string
  trace?: boolean
  workspaceDir?: string
}

export interface CreateDeckVoiceoverProjectResult {
  artifacts: DeckVoiceoverProjectArtifacts
  duration: number
  outputPath: string
  projectDir: string
  projectId: string
  slides: number
  status: 'voiced'
}

export interface CreateDeckAudioAnchoredProjectOptions {
  contentDensity?: DeckContentDensity
  deckFormat?: DeckFormat
  inputPath: string
  language?: string
  llmClient?: LLMClient
  maxSlideCharacters?: number
  projectId?: string
  requiredSlideTypes?: DeckSlideType[]
  theme?: string
  title?: string
  trace?: boolean
  workspaceDir?: string
}

export interface CreateDeckAudioAnchoredProjectResult {
  artifacts: DeckAudioAnchoredPlanArtifacts
  duration: number
  outputPath: string
  projectDir: string
  projectId: string
  slides: number
  status: 'completed'
}

export interface CreateDeckAudioSummaryProjectResult extends CreateDeckExplainerProjectResult {
  artifacts: DeckAudioSummaryPlanArtifacts
  sourceMode: 'audio-summary'
}

export type CreateDeckSummarizeProjectOptions = Omit<CreateDeckExplainerProjectOptions, 'mode'>
export type CreateDeckSummarizeProjectResult = CreateDeckExplainerProjectResult | CreateDeckAudioSummaryProjectResult

export type {DeckVoiceover, DeckVoiceoverSegment} from './voiceover-types.js'
