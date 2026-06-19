export interface DeckVoiceoverSegment {
  duration: number
  narrationId: string
  path: string
  slideId: string
  start: number
}

export interface DeckVoiceover {
  duration: number
  generatedAt: string
  outputPath: string
  segments: DeckVoiceoverSegment[]
  version: 1
}
