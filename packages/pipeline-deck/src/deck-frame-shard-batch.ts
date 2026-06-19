import {TimedDeckSchema} from '@video-agent/ir'
import {writeDeckHtmlProject} from '@video-agent/renderer-deck'
import {captureDeckHtmlFrameSequence, createDeckHtmlFrameSequence} from '@video-agent/renderer-html'
import {mkdir, rm} from 'node:fs/promises'
import {resolve} from 'node:path'

import {refreshArtifactManifest} from '@video-agent/runtime'
import {DEFAULT_DECK_RENDER_FPS, assertCompleteDeckFrameSequence, createDeckFrameCaptureFromFrames, createDeckFrameManifest, createDeckFrameShardArtifact, createDeckFrameShardRanges, createPlannedDeckFrameManifest, normalizeDeckFrameConcurrency, normalizeDeckFrameShardSize, normalizeDeckShardConcurrency, normalizeDeckShardRetries, normalizeDeckShardRetryDelayMs, readReusableDeckFrameManifest, retryDeckShardCapture, runConcurrentMap, sha256File} from './deck-frame-artifacts.js'
import {beginDeckFrameShardBatch, completeDeckFrameShardBatch, failDeckFrameShardBatch, openDeckFrameShardWorkspace} from './deck-frame-shard-runtime.js'
import type {CreateDeckFrameShardBatchProjectOptions, CreateDeckFrameShardBatchProjectResult, DeckFrameShardBatchShard} from './deck-frame-shard-types.js'
import {toProjectPath} from './deck-project-paths.js'

export async function createDeckFrameShardBatchProject(options: CreateDeckFrameShardBatchProjectOptions): Promise<CreateDeckFrameShardBatchProjectResult> {
  const context = await openDeckFrameShardWorkspace(options)
  const {projectId, workspace} = context

  await beginDeckFrameShardBatch(context)

  try {
    const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson('timed-deck.json'))
    const framesDir = resolve(workspace.rendersDir, 'deck-frames')
    const htmlOutputDir = resolve(workspace.rendersDir, 'html-shards')
    const frameCaptureBackend = options.frameCaptureBackend ?? 'playwright'
    const frameConcurrency = normalizeDeckFrameConcurrency(options.frameConcurrency)
    const shardConcurrency = normalizeDeckShardConcurrency(options.shardConcurrency)
    const shardRetries = normalizeDeckShardRetries(options.shardRetries)
    const shardRetryDelayMs = normalizeDeckShardRetryDelayMs(options.shardRetryDelayMs)
    const frameShardSize = normalizeDeckFrameShardSize(options.frameShardSize)
    const timedDeckSourceSha256 = await sha256File(workspace.store.resolve('timed-deck.json'))
    const reusableFrameManifest = await readReusableDeckFrameManifest(workspace, {
      fps: DEFAULT_DECK_RENDER_FPS,
      outputDir: framesDir,
      sourceSha256: timedDeckSourceSha256,
    })

    if (reusableFrameManifest === undefined) {
      await rm(framesDir, {force: true, recursive: true})
    }
    await Promise.all([
      rm(htmlOutputDir, {force: true, recursive: true}),
      mkdir(framesDir, {recursive: true}),
    ])

    const htmlProject = await writeDeckHtmlProject({
      outputDir: htmlOutputDir,
      timedDeck,
    })
    const frames = createDeckHtmlFrameSequence({
      fps: DEFAULT_DECK_RENDER_FPS,
      outputDir: framesDir,
      timedDeck,
    })
    const ranges = createDeckFrameShardRanges(frames.length, frameShardSize)
    let frameManifestPath = await workspace.store.writeJson('deck-frame-manifest.json', createPlannedDeckFrameManifest({
      concurrency: frameConcurrency,
      fps: DEFAULT_DECK_RENDER_FPS,
      outputDir: framesDir,
      projectDir: workspace.projectDir,
      renderer: frameCaptureBackend,
      sourceSha256: timedDeckSourceSha256,
      timedDeck,
    }))
    const shardResults = await runConcurrentMap(ranges, shardConcurrency, async (range): Promise<DeckFrameShardBatchShard> => {
      let attempts = 0

      try {
        const frameCapture = await retryDeckShardCapture({
          delayMs: shardRetryDelayMs,
          retries: shardRetries,
          run: async () => {
            attempts += 1

            return captureDeckHtmlFrameSequence({
              backend: frameCaptureBackend,
              chromiumCommand: options.chromiumCommand,
              concurrency: frameConcurrency,
              frameEnd: range.end,
              frameStart: range.start,
              fps: DEFAULT_DECK_RENDER_FPS,
              outputDir: framesDir,
              playwrightCommand: options.playwrightCommand,
              projectDir: htmlProject.outputDir,
              reuseExistingFrames: true,
              timedDeck,
            })
          },
        })
        const artifactPath = await workspace.store.writeJson(`deck-frame-shard-${String(range.start).padStart(6, '0')}-${String(range.end).padStart(6, '0')}.json`, createDeckFrameShardArtifact({
          frameCapture,
          projectDir: workspace.projectDir,
          sourceSha256: timedDeckSourceSha256,
        }))

        return {
          artifactPath,
          attempts,
          capturedFrames: frameCapture.capturedFrames,
          frameCount: range.end - range.start + 1,
          frameEnd: range.end,
          frameStart: range.start,
          skippedFrames: frameCapture.skippedFrames,
          status: 'complete',
        }
      } catch (error) {
        return {
          attempts,
          capturedFrames: 0,
          error: error instanceof Error ? error.message : String(error),
          frameCount: range.end - range.start + 1,
          frameEnd: range.end,
          frameStart: range.start,
          skippedFrames: 0,
          status: 'failed',
        }
      }
    })
    const frameCapture = createDeckFrameCaptureFromFrames({
      backend: frameCaptureBackend,
      capturedFrames: shardResults.reduce((total, shard) => total + shard.capturedFrames, 0),
      concurrency: frameConcurrency,
      fps: DEFAULT_DECK_RENDER_FPS,
      frames,
      outputDir: framesDir,
      skippedFrames: shardResults.reduce((total, shard) => total + shard.skippedFrames, 0),
      timedDeck,
    })

    frameManifestPath = await workspace.store.writeJson('deck-frame-manifest.json', createDeckFrameManifest({
      frameCapture,
      projectDir: workspace.projectDir,
      sourceSha256: timedDeckSourceSha256,
    }))

    const failedShards = shardResults.filter((shard) => shard.status === 'failed').length
    const completedShards = shardResults.length - failedShards
    const status = failedShards === 0 ? 'completed' as const : 'partial' as const
    const artifact = {
      completedShards,
      duration: frameCapture.duration,
      failedShards,
      fps: frameCapture.fps,
      frameCapturedCount: frameCapture.capturedFrames,
      frameConcurrency,
      frameCount: frameCapture.frames.length,
      frameManifestPath: toProjectPath(workspace.projectDir, frameManifestPath),
      frameShardSize,
      frameSkippedCount: frameCapture.skippedFrames,
      generatedAt: new Date().toISOString(),
      htmlOutputDir: toProjectPath(workspace.projectDir, htmlProject.outputDir),
      outputDir: toProjectPath(workspace.projectDir, frameCapture.outputDir),
      renderer: frameCaptureBackend,
      shardConcurrency,
      shardRetryDelayMs,
      shardRetries,
      shards: shardResults.map((shard) => ({
        ...(shard.artifactPath === undefined ? {} : {artifactPath: toProjectPath(workspace.projectDir, shard.artifactPath)}),
        attempts: shard.attempts,
        capturedFrames: shard.capturedFrames,
        ...(shard.error === undefined ? {} : {error: shard.error}),
        frameCount: shard.frameCount,
        frameEnd: shard.frameEnd,
        frameStart: shard.frameStart,
        skippedFrames: shard.skippedFrames,
        status: shard.status,
      })),
      source: 'timed-deck.json',
      sourceSha256: timedDeckSourceSha256,
      status,
      version: 1 as const,
    }
    const artifactPath = await workspace.store.writeJson('deck-frame-shard-batch.json', artifact)

    if (failedShards === 0) {
      await assertCompleteDeckFrameSequence(workspace.projectDir, frameCapture.frames)
      await completeDeckFrameShardBatch(context, 'Frame shard batch captured; run finalize-only to encode final video.')
    } else {
      await context.jobStore.updateStage('render-final', 'failed', `${failedShards} frame shard(s) failed; rerun the batch or capture failed ranges before finalize-only.`, 1)
    }
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifactPath,
      completedShards,
      failedShards,
      frameCapturedCount: frameCapture.capturedFrames,
      frameConcurrency,
      frameCount: frameCapture.frames.length,
      frameManifestPath,
      frameShardSize,
      frameSkippedCount: frameCapture.skippedFrames,
      htmlEntryPath: htmlProject.entryHtml,
      htmlOutputDir: htmlProject.outputDir,
      projectDir: workspace.projectDir,
      projectId,
      renderer: frameCaptureBackend,
      shardConcurrency,
      shardRetryDelayMs,
      shardRetries,
      shardCount: shardResults.length,
      shards: shardResults,
      status,
    }
  } catch (error) {
    await failDeckFrameShardBatch(context, error)
    throw error
  }
}
