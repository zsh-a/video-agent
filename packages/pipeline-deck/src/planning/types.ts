import type {Claims, ContentBlock, Deck, DeckFormat, DeckSlideType, Document, LongVideoSelectedMoments, MediaInfo, Narration, Outline, SourceQuotes, SpeakerScript, Storyboard, TimedDeck, Timeline} from '@video-agent/ir'
import type {QualityIssue} from '@video-agent/quality'
import type {TranscriptSegment} from '@video-agent/providers'

export interface TextDeckProjectPlan {
  claims: Claims
  contentBlocks: {blocks: ContentBlock[]; version: 1}
  deck: Deck
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
  storyboard: Storyboard
  timedDeck: TimedDeck
  timeline: Timeline
}

export interface TextDeckProjectPlanOptions {
  deckFormat?: DeckFormat
  durationTargetSeconds?: number
  language: string
  maxSlideCharacters: number
  requiredSlideTypes?: DeckSlideType[]
  sourceType?: Document['source']['sourceType']
  theme?: string
  title?: string
  transcriptSegments?: TranscriptSegment[]
}
