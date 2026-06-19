import {TimedDeckSchema} from '@video-agent/ir'
import {createDeckHtmlFrameSequence} from '@video-agent/renderer-html'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'

import {refreshArtifactManifest} from '@video-agent/runtime'
import {DEFAULT_DECK_FRAME_CONCURRENCY, DEFAULT_DECK_RENDER_FPS, createPlannedDeckFrameManifest, findMissingDeckFrameFiles, normalizeDeckFrameShardSize, sha256File} from './deck-frame-artifacts.js'
import {openDeckFrameShardWorkspace} from './deck-frame-shard-runtime.js'
import type {CreateDeckFrameShardPlanProjectOptions, CreateDeckFrameShardPlanProjectResult, DeckFrameShardPlanShard} from './deck-frame-shard-types.js'
import {toProjectPath} from './deck-project-paths.js'
import {roundSeconds} from './deck-utils.js'

export async function createDeckFrameShardPlanProject(options: CreateDeckFrameShardPlanProjectOptions): Promise<CreateDeckFrameShardPlanProjectResult> {
  const {projectId, workspace} = await openDeckFrameShardWorkspace(options)
  const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson('timed-deck.json'))
  const framesDir = resolve(workspace.rendersDir, 'deck-frames')
  const frameCaptureBackend = options.frameCaptureBackend ?? 'playwright'
  const frameShardSize = normalizeDeckFrameShardSize(options.frameShardSize)
  const timedDeckSourceSha256 = await sha256File(workspace.store.resolve('timed-deck.json'))
  const frames = createDeckHtmlFrameSequence({
    fps: DEFAULT_DECK_RENDER_FPS,
    outputDir: framesDir,
    timedDeck,
  })

  await mkdir(framesDir, {recursive: true})
  await workspace.store.writeJson('deck-frame-manifest.json', createPlannedDeckFrameManifest({
    concurrency: DEFAULT_DECK_FRAME_CONCURRENCY,
    fps: DEFAULT_DECK_RENDER_FPS,
    outputDir: framesDir,
    projectDir: workspace.projectDir,
    sourceSha256: timedDeckSourceSha256,
    timedDeck,
    renderer: frameCaptureBackend,
  }))

  const shards: DeckFrameShardPlanShard[] = []

  for (let frameStart = 1; frameStart <= frames.length; frameStart += frameShardSize) {
    const frameEnd = Math.min(frames.length, frameStart + frameShardSize - 1)
    const shardFrames = frames.filter((frame) => frame.frame >= frameStart && frame.frame <= frameEnd)
    // eslint-disable-next-line no-await-in-loop
    const missingFrames = await findMissingDeckFrameFiles(workspace.projectDir, shardFrames)
    const existingFrames = shardFrames.length - missingFrames.length
    const status = missingFrames.length === 0 ? 'complete' : existingFrames > 0 ? 'partial' : 'pending'

    shards.push({
      commandArgs: [
        'deck',
        'render',
        projectId,
        '--frame-start',
        String(frameStart),
        '--frame-end',
        String(frameEnd),
        ...(frameCaptureBackend === 'chromium' ? [] : ['--frame-capture-backend', frameCaptureBackend]),
      ],
      existingFrames,
      frameCount: shardFrames.length,
      frameEnd,
      frameStart,
      missingFrameSamples: missingFrames.slice(0, 5).map((frame) => ({
        frame: frame.frame,
        path: toProjectPath(workspace.projectDir, frame.path),
      })),
      missingFrames: missingFrames.length,
      shardArtifactPath: `artifacts/deck-frame-shard-${String(frameStart).padStart(6, '0')}-${String(frameEnd).padStart(6, '0')}.json`,
      status,
    })
  }

  const artifact = {
    completeShards: shards.filter((shard) => shard.status === 'complete').length,
    duration: roundSeconds(frames.length / DEFAULT_DECK_RENDER_FPS),
    finalizeArgs: ['deck', 'render', projectId, '--finalize-only'],
    fps: DEFAULT_DECK_RENDER_FPS,
    frameCount: frames.length,
    frameManifestPath: 'artifacts/deck-frame-manifest.json',
    frameShardSize,
    generatedAt: new Date().toISOString(),
    outputDir: toProjectPath(workspace.projectDir, framesDir),
    partialShards: shards.filter((shard) => shard.status === 'partial').length,
    pendingShards: shards.filter((shard) => shard.status === 'pending').length,
    renderer: frameCaptureBackend,
    shards,
    source: 'timed-deck.json',
    sourceSha256: timedDeckSourceSha256,
    version: 1 as const,
  }
  const artifactPath = await workspace.store.writeJson('deck-frame-shard-plan.json', artifact)

  await refreshArtifactManifest(workspace.artifactsDir)

  return {
    artifactPath,
    completeShards: artifact.completeShards,
    duration: artifact.duration,
    finalizeArgs: artifact.finalizeArgs,
    frameCount: artifact.frameCount,
    frameShardSize,
    partialShards: artifact.partialShards,
    pendingShards: artifact.pendingShards,
    projectDir: workspace.projectDir,
    projectId,
    shardCount: shards.length,
    shards,
    status: 'planned',
  }
}
