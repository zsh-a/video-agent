import type {ASRResult, ClipPlan, LongVideoChapterSummaries, LongVideoChunkPlan, LongVideoChunkSummaries, LongVideoGlobalOutline, LongVideoSelectedMoments, MediaInfo, Narration, NarrationSegment, RecapScript, SourceManifest, StoryIndex, Storyboard, VLMAnalysis} from '@video-agent/ir'

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
  timestampConfidence?: TranscriptTimestampConfidence
}

export type TranscriptTimestampConfidence = 'chunked' | 'exact' | 'untimed'

export interface SceneFrameBatch {
  frames: string[]
  sceneId: string
  timeRange: [number, number]
}

export interface VLMScene {
  description: string
  evidence: string[]
  sceneId: string
}

export interface TTSSegment {
  duration: number
  narrationId: string
  path: string
}

export interface ASRProvider {
  transcribe(input: MediaInput): Promise<Transcript>
}

export interface ScriptProvider {
  createNarration(input: ScriptProviderInput): Promise<Narration>
  createRecapScript(input: RecapScriptProviderInput): Promise<RecapScript>
}

export interface ScriptProviderInput {
  clipPlan: ClipPlan
  longVideo?: LongVideoPlanningContext
  storyboard: Storyboard
}

export interface RecapScriptProviderInput {
  asrResult: ASRResult
  sourceManifest: SourceManifest
  storyIndex: StoryIndex
  targetDurationSeconds?: number
  vlmAnalysis: VLMAnalysis
}

export interface StoryboardProvider {
  createStoryboard(input: StoryboardProviderInput): Promise<Storyboard>
}

export interface StoryboardProviderInput {
  longVideo?: LongVideoPlanningContext
  mediaInfo: MediaInfo
  sceneAnalysis: VLMScene[]
  transcript: Transcript
}

export interface LongVideoPlanningContext {
  chapters?: LongVideoChapterSummaries
  chunkPlan?: LongVideoChunkPlan
  chunkSummaries?: LongVideoChunkSummaries
  globalOutline?: LongVideoGlobalOutline
  selectedMoments?: LongVideoSelectedMoments
}

export interface TTSProviderSynthesizeOptions {
  outputDir?: string
  pathPrefix?: string
}

export interface TTSProvider {
  synthesize(segments: NarrationSegment[], options?: TTSProviderSynthesizeOptions): Promise<TTSSegment[]>
}

export interface VLMProvider {
  analyzeScenes(input: SceneFrameBatch[], context?: string): Promise<VLMScene[]>
}
