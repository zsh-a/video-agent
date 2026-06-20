import type {Claims, ContentBlock, Deck, DeckBrief, DeckCoherenceReport, DeckContentAnalysis, DeckCoverageReport, DeckFormat, DeckScriptTimingReport, DeckSlideOutline, DeckSlideType, DeckSourceMap, Document, LongVideoSelectedMoments, MediaInfo, Narration, Outline, SourceQuotes, SpeakerScript, Storyboard, TimedDeck, Timeline} from '@video-agent/ir'
import type {QualityIssue} from '@video-agent/quality'
import type {TranscriptSegment} from '@video-agent/providers'

export interface TextDeckProjectPlan {
  claims: Claims
  contentBlocks: {blocks: ContentBlock[]; version: 1}
  contentAnalysis: DeckContentAnalysis
  coherenceReport: DeckCoherenceReport
  coverageReport: DeckCoverageReport
  deck: Deck
  deckBrief: DeckBrief
  document: Document
  mediaInfo: MediaInfo
  narration: Narration
  outline: Outline
  qualityReport: {
    checkedAt: string
    issues: QualityIssue[]
    narrationSegments: number
    summary: {errors: number; warnings: number}
    ttsSegments: number
    version: 1
  }
  selectedMoments: LongVideoSelectedMoments
  sourceQuotes: SourceQuotes
  speakerScript: SpeakerScript
  scriptTimingReport: DeckScriptTimingReport
  slideOutline: DeckSlideOutline
  sourceMap: DeckSourceMap
  storyboard: Storyboard
  timedDeck: TimedDeck
  timeline: Timeline
}

export interface TextDeckProjectPlanOptions {
  contentAnalysis?: DeckContentAnalysis
  coherenceReport?: DeckCoherenceReport
  deckBrief?: DeckBrief
  deckFormat?: DeckFormat
  durationTargetSeconds?: number
  language: string
  maxSlideCharacters: number
  requiredSlideTypes?: DeckSlideType[]
  slideOutline?: DeckSlideOutline
  speakerNoteTimingBudget?: boolean
  sourceType?: Document['source']['sourceType']
  sourceMap?: DeckSourceMap
  theme?: string
  title?: string
  transcriptSegments?: TranscriptSegment[]
}
