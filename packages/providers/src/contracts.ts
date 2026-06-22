import type {ASRResult, CharacterIndex, NarrativeBeats, RecapScript, SourceManifest, StoryIndex, TimelineFusion, VLMAnalysis} from '@video-agent/ir'

export interface MediaInput {
  duration?: number
  mimeType?: string
  path: string
}

export interface TranscriptSegment {
  end: number
  speaker?: string
  start: number
  text: string
}

export interface Transcript {
  language?: string
  segments: TranscriptSegment[]
  text: string
  timestampConfidence: TranscriptTimestampConfidence
}

export type TranscriptTimestampConfidence = 'exact'

export interface SceneFrameBatch {
  frames: string[]
  sceneId: string
  timeRange: [number, number]
}

export interface VLMScene {
  actions?: string[]
  characters?: string[]
  description: string
  emotions?: string[]
  evidence: string[]
  plotClues?: string[]
  relationships?: string[]
  sceneId: string
}

export interface TTSSegment {
  duration: number
  narrationId: string
  path: string
}

export interface TTSInputSegment {
  duration: number
  id: string
  text: string
  voice?: string
}

export interface ASRProvider {
  transcribe(input: MediaInput): Promise<Transcript>
}

export interface ScriptProvider {
  createRecapScript(input: RecapScriptProviderInput): Promise<RecapScript>
  createStoryIndex(input: StoryIndexProviderInput): Promise<StoryIndexProviderOutput>
}

export interface RecapScriptProviderInput {
  asrResult: ASRResult
  sourceManifest: SourceManifest
  storyIndex: StoryIndex
  targetDurationSeconds?: number
  vlmAnalysis: VLMAnalysis
}

export interface StoryIndexProviderInput {
  asrResult: ASRResult
  language: string
  sourceManifest: SourceManifest
  timelineFusion: TimelineFusion
  vlmAnalysis: VLMAnalysis
}

export interface StoryIndexProviderOutput {
  characterIndex: CharacterIndex
  narrativeBeats: NarrativeBeats
  storyIndex: StoryIndex
}

export interface TTSProviderSynthesizeOptions {
  outputDir?: string
  pathPrefix?: string
}

export interface TTSProvider {
  synthesize(segments: TTSInputSegment[], options?: TTSProviderSynthesizeOptions): Promise<TTSSegment[]>
}

export interface VLMProvider {
  analyzeScenes(input: SceneFrameBatch[], context?: string): Promise<VLMScene[]>
}
