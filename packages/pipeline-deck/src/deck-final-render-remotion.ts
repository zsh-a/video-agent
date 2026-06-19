import {DeckQualityReportSchema, TimedDeckSchema} from '@video-agent/ir'
import {compileDeckMotionPlan, resolveMotionStepsForTemplate} from '@video-agent/renderer-deck'
import {renderRemotionDeckMedia, writeRemotionDeckProject} from '@video-agent/renderer-remotion'
import {mkdir, rm} from 'node:fs/promises'
import {resolve} from 'node:path'

import {assertFileExists} from '@video-agent/runtime'
import {createDeckRendererBackendArtifact} from './deck-backend-artifacts.js'
import {removeDeckHtmlFrameArtifacts} from './deck-final-cleanup.js'
import {inspectDeckRenderedOutput, muxDeckFinalVideo, writeDeckSubtitles} from './deck-final-media.js'
import {completeDeckFinalRender, failDeckFinalRender, openDeckFinalRenderContext} from './deck-final-render-runtime.js'
import type {CreateDeckFinalRenderProjectOptions, CreateDeckFinalRenderProjectResult} from './deck-final-render-types.js'
import {normalizeDeckRendererFps, sha256File} from './deck-frame-artifacts.js'
import {createDeckFinalVideoKeyframeQuality} from './deck-keyframe-quality.js'
import {createDeckQualityReport} from './deck-quality.js'
import {writeDeckRemotionRenderOutputArtifact} from './deck-render-output-artifacts.js'
import {writeDeckReviewArtifacts} from './deck-review.js'

export async function createDeckRemotionFinalRenderProject(options: CreateDeckFinalRenderProjectOptions): Promise<CreateDeckFinalRenderProjectResult> {
  const context = await openDeckFinalRenderContext(options)
  const {projectId, workspace} = context

  try {
    const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson('timed-deck.json'))
    const audioRef = timedDeck.audioRef ?? 'audio/deck_voiceover.wav'
    const audioPath = resolve(workspace.projectDir, audioRef)
    const remotionOutputDir = resolve(workspace.rendersDir, 'remotion')
    const silentVideoPath = resolve(workspace.rendersDir, 'deck_silent.mp4')
    const outputPath = resolve(workspace.rendersDir, 'final.mp4')
    const sourceSha256 = await sha256File(workspace.store.resolve('timed-deck.json'))
    const motionTimeline = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate).timeline
    const fps = normalizeDeckRendererFps(motionTimeline.fps)

    await assertFileExists(audioPath)
    await rm(remotionOutputDir, {force: true, recursive: true})
    await removeDeckHtmlFrameArtifacts(workspace)
    await mkdir(workspace.rendersDir, {recursive: true})

    const remotionProject = await writeRemotionDeckProject({
      compositionId: options.compositionId,
      fps,
      motionTimeline,
      outputDir: remotionOutputDir,
      timedDeck,
    })
    const backendArtifact = createDeckRendererBackendArtifact({
      backend: 'remotion',
      backendProject: remotionProject,
      motionTimeline,
      projectDir: workspace.projectDir,
      projectId,
      sourceSha256,
    })
    const backendArtifactPath = await workspace.store.writeJson('deck-renderer-remotion.json', backendArtifact)
    const remotion = await renderRemotionDeckMedia({
      outputPath: silentVideoPath,
      project: remotionProject,
    })
    const deckQualityReport = DeckQualityReportSchema.parse(createDeckQualityReport(timedDeck))
    const deckQualityReportPath = await workspace.store.writeJson('deck-quality-report.json', deckQualityReport)
    const subtitleOutput = await writeDeckSubtitles(workspace, timedDeck)

    await muxDeckFinalVideo({
      audioPath,
      outputPath,
      silentVideoPath,
      subtitlePath: subtitleOutput.outputPath,
    })

    const keyframeQuality = await createDeckFinalVideoKeyframeQuality(workspace, timedDeck, outputPath, fps)
    const keyframeQualityPath = await workspace.store.writeJson('deck-keyframes.json', keyframeQuality.artifact)
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
      videoRenderer: 'remotion+ffmpeg',
      workspace,
    })
    const artifactPath = await writeDeckRemotionRenderOutputArtifact(workspace, {
      audioPath,
      backendArtifactPath,
      keyframeQuality,
      keyframeQualityPath,
      outputPath,
      outputQuality,
      remotion,
      remotionProjectDir: remotionProject.outputDir,
      review,
      silentVideoPath,
      sourceSha256,
      subtitleOutput,
    })

    await completeDeckFinalRender(context)

    return {
      artifactPath,
      audioPath,
      deckQualityReportPath,
      finalized: true,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      keyframeQualityPath,
      keyframeRenderer: keyframeQuality.artifact.renderer,
      remotion,
      reviewHtmlPath: review.htmlPath,
      reviewReportPath: review.reportPath,
      renderer: 'remotion',
      status: 'rendered',
      subtitleMuxMode: 'mov_text',
      subtitleMuxed: true,
      subtitlePath: subtitleOutput.outputPath,
      subtitleQuality: subtitleOutput.quality,
      videoRenderer: 'remotion+ffmpeg',
      visualQuality: keyframeQuality.visualQuality,
    }
  } catch (error) {
    await failDeckFinalRender(context, error)
    throw error
  }
}
