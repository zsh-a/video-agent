import type {DeckHtmlCaptureBackend, TimedDeck} from '@video-agent/ir'

export interface DeckHtmlFrame {
  duration: number
  path: string
  slideId: string
  time: number
}

export interface DeckHtmlFrameSequenceFrame {
  frame: number
  path: string
  slideId: string
  time: number
}

export interface DeckHtmlKeyframe {
  frame: number
  label: string
  path: string
  slideId: string
  time: number
}

export interface CaptureDeckHtmlFramesOptions {
  chromiumCommand?: string[]
  outputDir: string
  projectDir: string
  timedDeck: TimedDeck
}

export interface CaptureDeckHtmlFramesResult {
  command: string[]
  frames: DeckHtmlFrame[]
  outputDir: string
  viewport: {
    height: number
    width: number
  }
}

export interface CaptureDeckHtmlFrameSequenceOptions {
  backend?: DeckHtmlCaptureBackend
  chromiumCommand?: string[]
  concurrency?: number
  frameEnd?: number
  frameStart?: number
  fps: number
  outputDir: string
  playwrightCommand?: string[]
  projectDir: string
  reuseExistingFrames?: boolean
  timedDeck: TimedDeck
}

export interface CaptureDeckHtmlFrameSequenceResult {
  backend: DeckHtmlCaptureBackend
  capturedFrames: number
  command: string[]
  concurrency: number
  frameEnd: number
  frameStart: number
  duration: number
  fps: number
  frames: DeckHtmlFrameSequenceFrame[]
  outputDir: string
  pattern: string
  skippedFrames: number
  viewport: {
    height: number
    width: number
  }
}

export interface CaptureDeckHtmlKeyframesOptions {
  backend?: DeckHtmlCaptureBackend
  chromiumCommand?: string[]
  concurrency?: number
  fps: number
  outputDir: string
  playwrightCommand?: string[]
  projectDir: string
  timedDeck: TimedDeck
}

export interface CaptureDeckHtmlKeyframesResult {
  backend: DeckHtmlCaptureBackend
  capturedFrames: number
  command: string[]
  concurrency: number
  duration: number
  fps: number
  frames: DeckHtmlKeyframe[]
  outputDir: string
  viewport: {
    height: number
    width: number
  }
}

export interface PlaywrightKeyframeCaptureManifest {
  frames: Array<DeckHtmlKeyframe & {url: string}>
  generatedAt: string
  viewport: {
    height: number
    width: number
  }
  version: 1
}

export interface PlaywrightFrameSequenceCaptureManifest {
  frames: Array<DeckHtmlFrameSequenceFrame & {url: string}>
  generatedAt: string
  viewport: {
    height: number
    width: number
  }
  version: 1
}
