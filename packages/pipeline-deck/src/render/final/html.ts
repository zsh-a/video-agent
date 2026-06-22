import type {CaptureDeckHtmlFrameSequenceResult} from '@video-agent/renderer-html'

import {DeckQualityReportSchema, DEFAULT_DECK_HTML_CAPTURE_BACKEND, TimedDeckSchema} from '@video-agent/ir'
import {writeDeckHtmlProject} from '@video-agent/renderer-deck'
import {captureDeckHtmlFrameSequence, captureDeckHtmlKeyframes} from '@video-agent/renderer-html'
import {renderHyperframesProject, validateHyperframesProject} from '@video-agent/renderer-hyperframes'
import {DECK_FRAME_MANIFEST_ARTIFACT_NAME, DECK_KEYFRAMES_ARTIFACT_NAME, DECK_QUALITY_REPORT_ARTIFACT_NAME, HTML_RENDER_OUTPUT_RENDERER, TIMED_DECK_ARTIFACT_NAME, deckHtmlVideoRendererForCaptureBackend} from '@video-agent/runtime'
import {mkdir, rm} from 'node:fs/promises'
import {resolve} from 'node:path'

import {removeDeckFinalRenderArtifacts} from './cleanup.js'
import {inspectDeckRenderedOutput, muxDeckFinalVideo, renderDeckFrameSequenceVideo, writeDeckSubtitles} from './media.js'
import {beginDeckFinalRender, completeDeckFinalRender, failDeckFinalRender, openDeckFinalRenderContext} from './runtime.js'
import type {CreateDeckFinalRenderProjectOptions, CreateDeckFinalRenderProjectResult} from './types.js'
import {DEFAULT_DECK_RENDER_FPS, assertCompleteDeckFrameSequence, createDeckFrameCaptureFromManifest, createDeckFrameManifest, createDeckFrameShardArtifact, createPlannedDeckFrameManifest, normalizeDeckFrameConcurrency, normalizeDeckFrameRange, readReusableDeckFrameManifest, resolveDeckFinalizeOnlyManifest, sha256File} from '../frames/index.js'
import {createDeckKeyframeQuality} from '../../quality/keyframes.js'
import {assertDeckQualityReportHasNoErrors, createDeckQualityReport} from '../../quality/report.js'
import {writeDeckHtmlRenderOutputArtifact} from '../output-artifacts.js'
import {writeDeckReviewArtifacts} from '../../quality/review.js'
import {assertFileExists, requireTimedDeckDuration} from '../../shared/utils.js'

export async function createDeckHtmlFinalRenderProject(options: CreateDeckFinalRenderProjectOptions): Promise<CreateDeckFinalRenderProjectResult> {
  const context = await openDeckFinalRenderContext(options)
  const {projectId, workspace} = context

  try {
    const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson(TIMED_DECK_ARTIFACT_NAME))
    const deckQualityReport = DeckQualityReportSchema.parse(createDeckQualityReport(timedDeck))
    const deckQualityReportPath = await workspace.store.writeJson(DECK_QUALITY_REPORT_ARTIFACT_NAME, deckQualityReport)

    assertDeckQualityReportHasNoErrors(deckQualityReport, deckQualityReportPath)

    const audioRef = requireTimedDeckAudioRef(timedDeck, 'Deck HTML final render')
    const audioPath = resolve(workspace.projectDir, audioRef)
    const framesDir = resolve(workspace.rendersDir, 'deck-frames')
    const htmlOutputDir = resolve(workspace.rendersDir, 'html')
    const htmlRenderedOutputPath = resolve(options.htmlOutput ?? resolve(workspace.rendersDir, 'deck_html_capture.mp4'))
    const silentVideoPath = resolve(workspace.rendersDir, 'deck_silent.mp4')
    const outputPath = resolve(workspace.rendersDir, 'final.mp4')
    const frameCaptureBackend = options.frameCaptureBackend ?? DEFAULT_DECK_HTML_CAPTURE_BACKEND
    const frameConcurrency = normalizeDeckFrameConcurrency(options.frameConcurrency)
    const requestedFrameRange = normalizeDeckFrameRange(options)
    const finalizeOnly = options.finalizeOnly === true
    const shouldFinalize = finalizeOnly || requestedFrameRange === undefined || options.finalize === true
    const timedDeckSourceSha256 = await sha256File(workspace.store.resolve(TIMED_DECK_ARTIFACT_NAME))
    const reusableFrameManifest = await readReusableDeckFrameManifest(workspace, {
      fps: DEFAULT_DECK_RENDER_FPS,
      outputDir: framesDir,
      renderer: finalizeOnly ? undefined : frameCaptureBackend,
      sourceSha256: timedDeckSourceSha256,
    })
    const reuseExistingFrames = reusableFrameManifest !== undefined
    const finalizeOnlyManifest = resolveDeckFinalizeOnlyManifest({
      finalizeOnly,
      requestedFrameRange,
      reusableFrameManifest,
    })

    if (shouldFinalize) {
      await assertFileExists(audioPath)
    }
    if (!finalizeOnly && !reuseExistingFrames && requestedFrameRange === undefined) {
      await rm(framesDir, {force: true, recursive: true})
    }
    await rm(htmlOutputDir, {force: true, recursive: true})
    await mkdir(framesDir, {recursive: true})
    await beginDeckFinalRender(context, shouldFinalize ? 'Rendering final deck video' : 'Capturing deck frame shard')

    const htmlProject = await writeDeckHtmlProject({
      outputDir: htmlOutputDir,
      timedDeck,
    })
    const validation = options.htmlValidate === true
      ? await validateHyperframesProject({
          command: options.htmlRenderCommand,
          projectDir: htmlProject.outputDir,
        })
      : undefined
    const rendered = options.htmlRender === true
      ? await renderHyperframesProject({
          command: options.htmlRenderCommand,
          outputPath: htmlRenderedOutputPath,
          projectDir: htmlProject.outputDir,
        })
      : undefined
    const browserKeyframes = shouldFinalize && !finalizeOnly && !reuseExistingFrames
      ? await captureDeckHtmlKeyframes({
          backend: options.keyframeCaptureBackend,
          chromiumCommand: options.chromiumCommand,
          concurrency: frameConcurrency,
          fps: DEFAULT_DECK_RENDER_FPS,
          outputDir: resolve(workspace.rendersDir, 'deck-keyframes'),
          playwrightCommand: options.playwrightCommand,
          projectDir: htmlProject.outputDir,
          timedDeck,
        })
      : undefined
    let frameCapture: CaptureDeckHtmlFrameSequenceResult
    let frameManifestPath = workspace.store.resolve(DECK_FRAME_MANIFEST_ARTIFACT_NAME)

    if (finalizeOnlyManifest !== undefined) {
      frameCapture = createDeckFrameCaptureFromManifest({
        concurrency: frameConcurrency,
        manifest: finalizeOnlyManifest,
        projectDir: workspace.projectDir,
      })
    } else {
      await workspace.store.writeJson(DECK_FRAME_MANIFEST_ARTIFACT_NAME, createPlannedDeckFrameManifest({
        concurrency: frameConcurrency,
        fps: DEFAULT_DECK_RENDER_FPS,
        outputDir: framesDir,
        projectDir: workspace.projectDir,
        renderer: frameCaptureBackend,
        sourceSha256: timedDeckSourceSha256,
        timedDeck,
      }))
      frameCapture = await captureDeckHtmlFrameSequence({
        backend: frameCaptureBackend,
        chromiumCommand: options.chromiumCommand,
        concurrency: frameConcurrency,
        frameEnd: requestedFrameRange?.end,
        frameStart: requestedFrameRange?.start,
        fps: DEFAULT_DECK_RENDER_FPS,
        outputDir: framesDir,
        playwrightCommand: options.playwrightCommand,
        projectDir: htmlProject.outputDir,
        reuseExistingFrames,
        timedDeck,
      })
      frameManifestPath = await workspace.store.writeJson(DECK_FRAME_MANIFEST_ARTIFACT_NAME, createDeckFrameManifest({
        frameCapture,
        projectDir: workspace.projectDir,
        sourceSha256: timedDeckSourceSha256,
      }))
    }
    if (!shouldFinalize) {
      await removeDeckFinalRenderArtifacts(workspace)

      const artifactPath = await workspace.store.writeJson(`deck-frame-shard-${String(frameCapture.frameStart).padStart(6, '0')}-${String(frameCapture.frameEnd).padStart(6, '0')}.json`, createDeckFrameShardArtifact({
        frameCapture,
        projectDir: workspace.projectDir,
        sourceSha256: timedDeckSourceSha256,
      }))

      await completeDeckFinalRender(context, 'Frame shard captured; final encode was not run.')

      return {
        artifactPath,
        audioPath,
        deckQualityReportPath,
        finalized: false,
        frameCount: frameCapture.frames.length,
        frameEnd: frameCapture.frameEnd,
        frameManifestPath,
        frameRenderer: frameCapture.backend,
        frameStart: frameCapture.frameStart,
        htmlEntryPath: htmlProject.entryHtml,
        htmlOutputDir: htmlProject.outputDir,
        outputPath,
        projectDir: workspace.projectDir,
        projectId,
        ...(rendered === undefined ? {} : {rendered}),
        renderer: HTML_RENDER_OUTPUT_RENDERER,
        status: 'frames-rendered',
        ...(validation === undefined ? {} : {validation}),
        videoRenderer: deckHtmlVideoRendererForCaptureBackend(frameCapture.backend),
      }
    }

    await assertCompleteDeckFrameSequence(workspace.projectDir, frameCapture.frames)

    const keyframeQuality = await createDeckKeyframeQuality(workspace, frameCapture, browserKeyframes)
    const keyframeQualityPath = await workspace.store.writeJson(DECK_KEYFRAMES_ARTIFACT_NAME, keyframeQuality.artifact)
    const subtitleOutput = await writeDeckSubtitles(workspace, timedDeck)

    await renderDeckFrameSequenceVideo(frameCapture.pattern, frameCapture.fps, silentVideoPath)
    await muxDeckFinalVideo({
      audioPath,
      outputPath,
      silentVideoPath,
      subtitlePath: subtitleOutput.outputPath,
    })

    const outputQuality = await inspectDeckRenderedOutput(outputPath, {
      expectedDuration: requireTimedDeckDuration(timedDeck, 'Deck HTML final render'),
    })
    const review = await writeDeckReviewArtifacts({
      deckQualityReport,
      keyframeQuality,
      keyframeQualityPath,
      outputPath,
      outputQuality,
      projectId,
      subtitleQuality: subtitleOutput.quality,
      timedDeck,
      videoRenderer: deckHtmlVideoRendererForCaptureBackend(frameCapture.backend),
      workspace,
    })
    const artifactPath = await writeDeckHtmlRenderOutputArtifact(workspace, {
      audioPath,
      finalizeOnly,
      frameCapture,
      frameManifestPath,
      htmlProject,
      keyframeQuality,
      keyframeQualityPath,
      outputPath,
      outputQuality,
      rendered,
      reuseExistingFrames,
      review,
      silentVideoPath,
      sourceSha256: timedDeckSourceSha256,
      subtitleOutput,
      validation,
      videoRenderer: deckHtmlVideoRendererForCaptureBackend(frameCapture.backend),
    })

    await completeDeckFinalRender(context)

    return {
      artifactPath,
      audioPath,
      deckQualityReportPath,
      finalized: true,
      frameCount: frameCapture.frames.length,
      frameEnd: frameCapture.frameEnd,
      frameManifestPath,
      frameRenderer: frameCapture.backend,
      frameStart: frameCapture.frameStart,
      htmlEntryPath: htmlProject.entryHtml,
      htmlOutputDir: htmlProject.outputDir,
      keyframeQualityPath,
      keyframeRenderer: keyframeQuality.artifact.renderer,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      reviewHtmlPath: review.htmlPath,
      reviewReportPath: review.reportPath,
      ...(rendered === undefined ? {} : {rendered}),
      renderer: HTML_RENDER_OUTPUT_RENDERER,
      status: 'rendered',
      subtitleMuxMode: 'mov_text',
      subtitleMuxed: true,
      subtitlePath: subtitleOutput.outputPath,
      subtitleQuality: subtitleOutput.quality,
      ...(validation === undefined ? {} : {validation}),
      videoRenderer: deckHtmlVideoRendererForCaptureBackend(frameCapture.backend),
      visualQuality: keyframeQuality.visualQuality,
    }
  } catch (error) {
    await failDeckFinalRender(context, error)
    throw error
  }
}

function requireTimedDeckAudioRef(timedDeck: ReturnType<typeof TimedDeckSchema.parse>, context: string): string {
  if (timedDeck.audioRef === undefined || timedDeck.audioRef.trim() === '') {
    throw new Error(`${context} requires timed-deck.json audioRef from Deck voiceover or audio anchoring; no default audio path fallback is allowed.`)
  }

  return timedDeck.audioRef
}
