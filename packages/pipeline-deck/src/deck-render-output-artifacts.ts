import type {RenderedMediaQualityResult, SubtitleQualityResult, VisualSmokeQualityResult} from '@video-agent/quality'
import type {CaptureDeckHtmlFrameSequenceResult} from '@video-agent/renderer-html'
import type {HyperframesCliResult} from '@video-agent/renderer-hyperframes'
import type {RemotionRenderMediaResult} from '@video-agent/renderer-remotion'
import type {ProjectWorkspace} from '@video-agent/runtime'

import {toProjectPath} from './deck-project-paths.js'
import {type DeckReviewFrameRenderer} from './deck-review.js'

export interface DeckFinalKeyframeQualitySummary {
  artifact: {
    renderer: DeckReviewFrameRenderer
  }
  visualQuality: VisualSmokeQualityResult
}

export interface DeckReviewArtifactPaths {
  htmlPath: string
  reportPath: string
}

export interface DeckHtmlProjectPaths {
  entryHtml: string
  outputDir: string
  planPath: string
  runtimePath: string
  stylesPath: string
}

export async function writeDeckHtmlRenderOutputArtifact(workspace: ProjectWorkspace, input: {
  audioPath: string
  finalizeOnly: boolean
  frameCapture: CaptureDeckHtmlFrameSequenceResult
  frameManifestPath: string
  htmlProject: DeckHtmlProjectPaths
  keyframeQuality: DeckFinalKeyframeQualitySummary
  keyframeQualityPath: string
  outputPath: string
  outputQuality: RenderedMediaQualityResult
  rendered?: HyperframesCliResult
  reuseExistingFrames: boolean
  review: DeckReviewArtifactPaths
  silentVideoPath: string
  sourceSha256: string
  subtitleOutput: {
    outputPath: string
    quality: SubtitleQualityResult
  }
  validation?: HyperframesCliResult
  videoRenderer: 'chromium+ffmpeg' | 'playwright+ffmpeg'
}): Promise<string> {
  return workspace.store.writeJson('render-output.json', {
    audioInputs: 1,
    audioPath: toProjectPath(workspace.projectDir, input.audioPath),
    completedAt: new Date().toISOString(),
    entryHtml: toProjectPath(workspace.projectDir, input.htmlProject.entryHtml),
    finalizeOnly: input.finalizeOnly,
    finalized: true,
    frameCaptureDuration: input.frameCapture.duration,
    frameCapturedCount: input.frameCapture.capturedFrames,
    frameConcurrency: input.frameCapture.concurrency,
    frameCount: input.frameCapture.frames.length,
    frameEnd: input.frameCapture.frameEnd,
    frameFps: input.frameCapture.fps,
    frameManifestPath: toProjectPath(workspace.projectDir, input.frameManifestPath),
    framePattern: toProjectPath(workspace.projectDir, input.frameCapture.pattern),
    frameReuse: input.reuseExistingFrames,
    frameRenderer: input.frameCapture.backend,
    frameSkippedCount: input.frameCapture.skippedFrames,
    frameStart: input.frameCapture.frameStart,
    framesDir: toProjectPath(workspace.projectDir, input.frameCapture.outputDir),
    keyframeQualityPath: toProjectPath(workspace.projectDir, input.keyframeQualityPath),
    keyframeRenderer: input.keyframeQuality.artifact.renderer,
    outputDir: toProjectPath(workspace.projectDir, input.htmlProject.outputDir),
    outputPath: toProjectPath(workspace.projectDir, input.outputPath),
    outputQuality: input.outputQuality,
    planPath: toProjectPath(workspace.projectDir, input.htmlProject.planPath),
    renderer: 'html' as const,
    rendered: input.rendered,
    reviewHtmlPath: toProjectPath(workspace.projectDir, input.review.htmlPath),
    reviewReportPath: toProjectPath(workspace.projectDir, input.review.reportPath),
    runtimePath: toProjectPath(workspace.projectDir, input.htmlProject.runtimePath),
    silentVideoPath: toProjectPath(workspace.projectDir, input.silentVideoPath),
    source: 'timed-deck.json',
    sourceSha256: input.sourceSha256,
    stylesPath: toProjectPath(workspace.projectDir, input.htmlProject.stylesPath),
    subtitleMuxMode: 'mov_text' as const,
    subtitleMuxed: true,
    subtitlePath: toProjectPath(workspace.projectDir, input.subtitleOutput.outputPath),
    subtitleQuality: input.subtitleOutput.quality,
    subtitlesBurned: false,
    validation: input.validation,
    version: 1 as const,
    videoRenderer: input.videoRenderer,
    visualQuality: input.keyframeQuality.visualQuality,
  })
}

export async function writeDeckRemotionRenderOutputArtifact(workspace: ProjectWorkspace, input: {
  audioPath: string
  backendArtifactPath: string
  keyframeQuality: DeckFinalKeyframeQualitySummary
  keyframeQualityPath: string
  outputPath: string
  outputQuality: RenderedMediaQualityResult
  remotion: RemotionRenderMediaResult
  remotionProjectDir: string
  review: DeckReviewArtifactPaths
  silentVideoPath: string
  sourceSha256: string
  subtitleOutput: {
    outputPath: string
    quality: SubtitleQualityResult
  }
}): Promise<string> {
  return workspace.store.writeJson('render-output.json', {
    audioInputs: 1,
    audioPath: toProjectPath(workspace.projectDir, input.audioPath),
    backendArtifactPath: toProjectPath(workspace.projectDir, input.backendArtifactPath),
    completedAt: new Date().toISOString(),
    finalized: true,
    keyframeQualityPath: toProjectPath(workspace.projectDir, input.keyframeQualityPath),
    keyframeRenderer: input.keyframeQuality.artifact.renderer,
    outputPath: toProjectPath(workspace.projectDir, input.outputPath),
    outputQuality: input.outputQuality,
    renderer: 'remotion' as const,
    remotion: {
      codec: input.remotion.codec,
      compositionId: input.remotion.compositionId,
      concurrency: input.remotion.concurrency,
      imageFormat: input.remotion.imageFormat,
      jpegQuality: input.remotion.jpegQuality,
      outputPath: toProjectPath(workspace.projectDir, input.remotion.outputPath),
      slowestFrames: input.remotion.slowestFrames.slice(0, 10),
      x264Preset: input.remotion.x264Preset,
    },
    rendererProjectDir: toProjectPath(workspace.projectDir, input.remotionProjectDir),
    reviewHtmlPath: toProjectPath(workspace.projectDir, input.review.htmlPath),
    reviewReportPath: toProjectPath(workspace.projectDir, input.review.reportPath),
    silentVideoPath: toProjectPath(workspace.projectDir, input.silentVideoPath),
    source: 'timed-deck.json',
    sourceSha256: input.sourceSha256,
    subtitleMuxMode: 'mov_text' as const,
    subtitleMuxed: true,
    subtitlePath: toProjectPath(workspace.projectDir, input.subtitleOutput.outputPath),
    subtitleQuality: input.subtitleOutput.quality,
    subtitlesBurned: false,
    version: 1 as const,
    videoRenderer: 'remotion+ffmpeg' as const,
    visualQuality: input.keyframeQuality.visualQuality,
  })
}
