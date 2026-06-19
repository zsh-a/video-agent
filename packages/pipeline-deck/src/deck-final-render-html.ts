import type {CaptureDeckHtmlFrameSequenceResult} from '@video-agent/renderer-html'

import {DeckQualityReportSchema, TimedDeckSchema} from '@video-agent/ir'
import {writeDeckHtmlProject} from '@video-agent/renderer-deck'
import {captureDeckHtmlFrameSequence, captureDeckHtmlKeyframes} from '@video-agent/renderer-html'
import {renderHyperframesProject, validateHyperframesProject} from '@video-agent/renderer-hyperframes'
import {mkdir, rm} from 'node:fs/promises'
import {resolve} from 'node:path'

import {assertFileExists} from '@video-agent/runtime'
import {removeDeckFinalRenderArtifacts} from './deck-final-cleanup.js'
import {inspectDeckRenderedOutput, muxDeckFinalVideo, renderDeckFrameSequenceVideo, writeDeckSubtitles} from './deck-final-media.js'
import {completeDeckFinalRender, failDeckFinalRender, openDeckFinalRenderContext} from './deck-final-render-runtime.js'
import type {CreateDeckFinalRenderProjectOptions, CreateDeckFinalRenderProjectResult} from './deck-final-render-types.js'
import {DEFAULT_DECK_RENDER_FPS, assertCompleteDeckFrameSequence, createDeckFrameCaptureFromManifest, createDeckFrameManifest, createDeckFrameShardArtifact, createPlannedDeckFrameManifest, deckFrameVideoRenderer, normalizeDeckFrameConcurrency, normalizeDeckFrameRange, readReusableDeckFrameManifest, resolveDeckFinalizeOnlyManifest, sha256File} from './deck-frame-artifacts.js'
import {createDeckKeyframeQuality} from './deck-keyframe-quality.js'
import {createDeckQualityReport} from './deck-quality.js'
import {writeDeckHtmlRenderOutputArtifact} from './deck-render-output-artifacts.js'
import {writeDeckReviewArtifacts} from './deck-review.js'

export async function createDeckHtmlFinalRenderProject(options: CreateDeckFinalRenderProjectOptions): Promise<CreateDeckFinalRenderProjectResult> {
  const context = await openDeckFinalRenderContext(options)
  const {projectId, workspace} = context

  try {
    const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson('timed-deck.json'))
    const audioRef = timedDeck.audioRef ?? 'audio/deck_voiceover.wav'
    const audioPath = resolve(workspace.projectDir, audioRef)
    const framesDir = resolve(workspace.rendersDir, 'deck-frames')
    const htmlOutputDir = resolve(workspace.rendersDir, 'html')
    const htmlRenderedOutputPath = resolve(options.htmlOutput ?? resolve(workspace.rendersDir, 'deck_html_capture.mp4'))
    const silentVideoPath = resolve(workspace.rendersDir, 'deck_silent.mp4')
    const outputPath = resolve(workspace.rendersDir, 'final.mp4')
    const frameConcurrency = normalizeDeckFrameConcurrency(options.frameConcurrency)
    const requestedFrameRange = normalizeDeckFrameRange(options)
    const finalizeOnly = options.finalizeOnly === true
    const shouldFinalize = finalizeOnly || requestedFrameRange === undefined || options.finalize === true
    const timedDeckSourceSha256 = await sha256File(workspace.store.resolve('timed-deck.json'))
    const reusableFrameManifest = await readReusableDeckFrameManifest(workspace, {
      fps: DEFAULT_DECK_RENDER_FPS,
      outputDir: framesDir,
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
    let frameManifestPath = workspace.store.resolve('deck-frame-manifest.json')

    if (finalizeOnlyManifest !== undefined) {
      frameCapture = createDeckFrameCaptureFromManifest({
        concurrency: frameConcurrency,
        manifest: finalizeOnlyManifest,
        projectDir: workspace.projectDir,
      })
    } else {
      await workspace.store.writeJson('deck-frame-manifest.json', createPlannedDeckFrameManifest({
        concurrency: frameConcurrency,
        fps: DEFAULT_DECK_RENDER_FPS,
        outputDir: framesDir,
        projectDir: workspace.projectDir,
        renderer: options.frameCaptureBackend ?? 'playwright',
        sourceSha256: timedDeckSourceSha256,
        timedDeck,
      }))
      frameCapture = await captureDeckHtmlFrameSequence({
        backend: options.frameCaptureBackend,
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
      frameManifestPath = await workspace.store.writeJson('deck-frame-manifest.json', createDeckFrameManifest({
        frameCapture,
        projectDir: workspace.projectDir,
        sourceSha256: timedDeckSourceSha256,
      }))
    }
    const deckQualityReport = DeckQualityReportSchema.parse(createDeckQualityReport(timedDeck))
    const deckQualityReportPath = await workspace.store.writeJson('deck-quality-report.json', deckQualityReport)

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
        renderer: 'html',
        status: 'frames-rendered',
        ...(validation === undefined ? {} : {validation}),
        videoRenderer: deckFrameVideoRenderer(frameCapture.backend),
      }
    }

    await assertCompleteDeckFrameSequence(workspace.projectDir, frameCapture.frames)

    const keyframeQuality = await createDeckKeyframeQuality(workspace, frameCapture, browserKeyframes)
    const keyframeQualityPath = await workspace.store.writeJson('deck-keyframes.json', keyframeQuality.artifact)
    const subtitleOutput = await writeDeckSubtitles(workspace, timedDeck)

    await renderDeckFrameSequenceVideo(frameCapture.pattern, frameCapture.fps, silentVideoPath)
    await muxDeckFinalVideo({
      audioPath,
      outputPath,
      silentVideoPath,
      subtitlePath: subtitleOutput.outputPath,
    })

    const outputQuality = await inspectDeckRenderedOutput(outputPath, {
      expectedDuration: timedDeck.timings.at(-1)?.end ?? 0,
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
      videoRenderer: deckFrameVideoRenderer(frameCapture.backend),
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
      videoRenderer: deckFrameVideoRenderer(frameCapture.backend),
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
      renderer: 'html',
      status: 'rendered',
      subtitleMuxMode: 'mov_text',
      subtitleMuxed: true,
      subtitlePath: subtitleOutput.outputPath,
      subtitleQuality: subtitleOutput.quality,
      ...(validation === undefined ? {} : {validation}),
      videoRenderer: deckFrameVideoRenderer(frameCapture.backend),
      visualQuality: keyframeQuality.visualQuality,
    }
  } catch (error) {
    await failDeckFinalRender(context, error)
    throw error
  }
}
