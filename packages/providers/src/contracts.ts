import type {NarrationSegment} from '@video-agent/ir'

export interface MediaInput {
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
}

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

export interface TTSProvider {
  synthesize(segments: NarrationSegment[]): Promise<TTSSegment[]>
}

export interface VLMProvider {
  analyzeScenes(input: SceneFrameBatch[], context?: string): Promise<VLMScene[]>
}
