import type {SubtitleQualityResult, VisualSmokeQualityResult} from '@video-agent/quality'
import type {DeckHtmlFrameSequenceCaptureBackend, DeckHtmlKeyframeCaptureBackend} from '@video-agent/renderer-html'
import type {HyperframesCliResult} from '@video-agent/renderer-hyperframes'
import type {RemotionRenderMediaResult} from '@video-agent/renderer-remotion'

import type {DeckReviewFrameRenderer} from '../../quality/review.js'

export interface CreateDeckFinalRenderProjectOptions {
  chromiumCommand?: string[]
  compositionId?: string
  frameCaptureBackend?: DeckHtmlFrameSequenceCaptureBackend
  frameConcurrency?: number
  frameEnd?: number
  frameStart?: number
  finalize?: boolean
  finalizeOnly?: boolean
  htmlOutput?: string
  htmlRender?: boolean
  htmlRenderCommand?: string[]
  htmlValidate?: boolean
  keyframeCaptureBackend?: DeckHtmlKeyframeCaptureBackend
  playwrightCommand?: string[]
  projectId: string
  renderer?: 'html' | 'remotion'
  workspaceDir?: string
}

export interface CreateDeckFinalRenderProjectResult {
  artifactPath: string
  audioPath: string
  deckQualityReportPath: string
  finalized: boolean
  frameEnd?: number
  frameManifestPath?: string
  frameRenderer?: DeckHtmlFrameSequenceCaptureBackend
  frameStart?: number
  frameCount?: number
  htmlEntryPath?: string
  htmlOutputDir?: string
  keyframeQualityPath?: string
  keyframeRenderer?: DeckReviewFrameRenderer
  outputPath: string
  projectDir: string
  projectId: string
  remotion?: RemotionRenderMediaResult
  reviewHtmlPath?: string
  reviewReportPath?: string
  renderer: 'html' | 'remotion'
  rendered?: HyperframesCliResult
  status: 'frames-rendered' | 'rendered'
  subtitleMuxed?: boolean
  subtitleMuxMode?: 'mov_text'
  subtitlePath?: string
  subtitleQuality?: SubtitleQualityResult
  validation?: HyperframesCliResult
  videoRenderer: 'chromium+ffmpeg' | 'playwright+ffmpeg' | 'remotion+ffmpeg'
  visualQuality?: VisualSmokeQualityResult
}
