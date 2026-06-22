import type {DeckHtmlCaptureBackend} from '@video-agent/ir'
import type {SubtitleQualityResult, VisualSmokeQualityResult} from '@video-agent/quality'
import type {HyperframesCliResult} from '@video-agent/renderer-hyperframes'
import type {RemotionRenderMediaResult} from '@video-agent/renderer-remotion'
import type {DeckVideoRenderer} from '@video-agent/runtime'

import type {DeckReviewFrameRenderer} from '../../quality/review.js'
import type {DeckFinalRenderer} from '../renderers.js'

export interface CreateDeckFinalRenderProjectOptions {
  chromiumCommand?: string[]
  compositionId?: string
  frameCaptureBackend?: DeckHtmlCaptureBackend
  frameConcurrency?: number
  frameEnd?: number
  frameStart?: number
  finalize?: boolean
  finalizeOnly?: boolean
  htmlOutput?: string
  htmlRender?: boolean
  htmlRenderCommand?: string[]
  htmlValidate?: boolean
  keyframeCaptureBackend?: DeckHtmlCaptureBackend
  playwrightCommand?: string[]
  projectId: string
  renderer?: DeckFinalRenderer
  workspaceDir?: string
}

export interface CreateDeckFinalRenderProjectResult {
  artifactPath: string
  audioPath: string
  deckQualityReportPath: string
  finalized: boolean
  frameEnd?: number
  frameManifestPath?: string
  frameRenderer?: DeckHtmlCaptureBackend
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
  renderer: DeckFinalRenderer
  rendered?: HyperframesCliResult
  status: 'frames-rendered' | 'rendered'
  subtitleMuxed?: boolean
  subtitleMuxMode?: 'mov_text'
  subtitlePath?: string
  subtitleQuality?: SubtitleQualityResult
  validation?: HyperframesCliResult
  videoRenderer: DeckVideoRenderer
  visualQuality?: VisualSmokeQualityResult
}
