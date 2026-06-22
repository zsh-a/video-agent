import {DeckQualityReportSchema, TimedDeckSchema} from '@video-agent/ir'
import {compileDeckMotionPlan, resolveMotionStepsForTemplate} from '@video-agent/renderer-deck'
import {renderRemotionDeckMedia, writeRemotionDeckProject} from '@video-agent/renderer-remotion'
import {DECK_KEYFRAMES_ARTIFACT_NAME, DECK_QUALITY_REPORT_ARTIFACT_NAME, DECK_REMOTION_VIDEO_RENDERER, DECK_RENDERER_REMOTION_ARTIFACT_NAME, REMOTION_RENDER_OUTPUT_RENDERER, TIMED_DECK_ARTIFACT_NAME} from '@video-agent/runtime'
import {mkdir, rm} from 'node:fs/promises'
import {resolve} from 'node:path'

import {createDeckRendererBackendArtifact} from '../backend-artifacts.js'
import {removeDeckHtmlFrameArtifacts} from './cleanup.js'
import {inspectDeckRenderedOutput, muxDeckFinalVideo, writeDeckSubtitles} from './media.js'
import {beginDeckFinalRender, completeDeckFinalRender, failDeckFinalRender, openDeckFinalRenderContext} from './runtime.js'
import type {CreateDeckFinalRenderProjectOptions, CreateDeckFinalRenderProjectResult} from './types.js'
import {normalizeDeckRendererFps, sha256File} from '../frames/index.js'
import {createDeckFinalVideoKeyframeQuality} from '../../quality/keyframes.js'
import {assertDeckQualityReportHasNoErrors, createDeckQualityReport} from '../../quality/report.js'
import {writeDeckRemotionRenderOutputArtifact} from '../output-artifacts.js'
import {writeDeckReviewArtifacts} from '../../quality/review.js'
import {assertFileExists, requireTimedDeckDuration} from '../../shared/utils.js'

export async function createDeckRemotionFinalRenderProject(options: CreateDeckFinalRenderProjectOptions): Promise<CreateDeckFinalRenderProjectResult> {
  const context = await openDeckFinalRenderContext(options)
  const {projectId, workspace} = context

  try {
    const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson(TIMED_DECK_ARTIFACT_NAME))
    const audioRef = requireTimedDeckAudioRef(timedDeck, 'Deck Remotion final render')
    const audioPath = resolve(workspace.projectDir, audioRef)
    const remotionOutputDir = resolve(workspace.rendersDir, 'remotion')
    const silentVideoPath = resolve(workspace.rendersDir, 'deck_silent.mp4')
    const outputPath = resolve(workspace.rendersDir, 'final.mp4')
    const sourceSha256 = await sha256File(workspace.store.resolve(TIMED_DECK_ARTIFACT_NAME))
    const motionTimeline = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate).timeline
    const fps = normalizeDeckRendererFps(motionTimeline.fps)
    const deckQualityReport = DeckQualityReportSchema.parse(createDeckQualityReport(timedDeck))
    const deckQualityReportPath = await workspace.store.writeJson(DECK_QUALITY_REPORT_ARTIFACT_NAME, deckQualityReport)

    assertDeckQualityReportHasNoErrors(deckQualityReport, deckQualityReportPath)

    await assertFileExists(audioPath)
    await rm(remotionOutputDir, {force: true, recursive: true})
    await removeDeckHtmlFrameArtifacts(workspace)
    await mkdir(workspace.rendersDir, {recursive: true})
    await beginDeckFinalRender(context)

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
    const backendArtifactPath = await workspace.store.writeJson(DECK_RENDERER_REMOTION_ARTIFACT_NAME, backendArtifact)
    const remotion = await renderRemotionDeckMedia({
      outputPath: silentVideoPath,
      project: remotionProject,
    })
    const subtitleOutput = await writeDeckSubtitles(workspace, timedDeck)

    await muxDeckFinalVideo({
      audioPath,
      outputPath,
      silentVideoPath,
      subtitlePath: subtitleOutput.outputPath,
    })

    const keyframeQuality = await createDeckFinalVideoKeyframeQuality(workspace, timedDeck, outputPath, fps)
    const keyframeQualityPath = await workspace.store.writeJson(DECK_KEYFRAMES_ARTIFACT_NAME, keyframeQuality.artifact)
    const outputQuality = await inspectDeckRenderedOutput(outputPath, {
      expectedDuration: requireTimedDeckDuration(timedDeck, 'Deck Remotion final render'),
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
      videoRenderer: DECK_REMOTION_VIDEO_RENDERER,
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
      renderer: REMOTION_RENDER_OUTPUT_RENDERER,
      status: 'rendered',
      subtitleMuxMode: 'mov_text',
      subtitleMuxed: true,
      subtitlePath: subtitleOutput.outputPath,
      subtitleQuality: subtitleOutput.quality,
      videoRenderer: DECK_REMOTION_VIDEO_RENDERER,
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
