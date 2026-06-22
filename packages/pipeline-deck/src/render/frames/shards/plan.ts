import {DEFAULT_DECK_HTML_CAPTURE_BACKEND, TimedDeckSchema} from '@video-agent/ir'
import {createDeckHtmlFrameSequence} from '@video-agent/renderer-html'
import {mkdir, rm} from 'node:fs/promises'
import {resolve} from 'node:path'

import {DECK_FRAME_MANIFEST_ARTIFACT_NAME, DECK_FRAME_SHARD_COMPLETE_STATUS, DECK_FRAME_SHARD_PARTIAL_STATUS, DECK_FRAME_SHARD_PENDING_STATUS, DECK_FRAME_SHARD_PLAN_ARTIFACT_NAME, TIMED_DECK_ARTIFACT_NAME, refreshArtifactManifest} from '@video-agent/runtime'
import {DEFAULT_DECK_FRAME_CONCURRENCY, DEFAULT_DECK_RENDER_FPS, createPlannedDeckFrameManifest, findMissingDeckFrameFiles, normalizeDeckFrameShardSize, readReusableDeckFrameManifest, sha256File} from '../index.js'
import {openDeckFrameShardWorkspace} from './runtime.js'
import type {CreateDeckFrameShardPlanProjectOptions, CreateDeckFrameShardPlanProjectResult, DeckFrameShardPlanShard} from './types.js'
import {toProjectPath} from '../../../project/paths.js'
import {roundSeconds} from '../../../shared/utils.js'

export async function createDeckFrameShardPlanProject(options: CreateDeckFrameShardPlanProjectOptions): Promise<CreateDeckFrameShardPlanProjectResult> {
  const {projectId, workspace} = await openDeckFrameShardWorkspace(options)
  const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson(TIMED_DECK_ARTIFACT_NAME))
  const framesDir = resolve(workspace.rendersDir, 'deck-frames')
  const frameCaptureBackend = options.frameCaptureBackend ?? DEFAULT_DECK_HTML_CAPTURE_BACKEND
  const frameShardSize = normalizeDeckFrameShardSize(options.frameShardSize)
  const timedDeckSourceSha256 = await sha256File(workspace.store.resolve(TIMED_DECK_ARTIFACT_NAME))
  const reusableFrameManifest = await readReusableDeckFrameManifest(workspace, {
    fps: DEFAULT_DECK_RENDER_FPS,
    outputDir: framesDir,
    renderer: frameCaptureBackend,
    sourceSha256: timedDeckSourceSha256,
  })
  const frames = createDeckHtmlFrameSequence({
    fps: DEFAULT_DECK_RENDER_FPS,
    outputDir: framesDir,
    timedDeck,
  })

  if (reusableFrameManifest === undefined) {
    await rm(framesDir, {force: true, recursive: true})
  }
  await mkdir(framesDir, {recursive: true})
  await workspace.store.writeJson(DECK_FRAME_MANIFEST_ARTIFACT_NAME, createPlannedDeckFrameManifest({
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
    const status = missingFrames.length === 0
      ? DECK_FRAME_SHARD_COMPLETE_STATUS
      : existingFrames > 0 ? DECK_FRAME_SHARD_PARTIAL_STATUS : DECK_FRAME_SHARD_PENDING_STATUS

    shards.push({
      commandArgs: [
        'deck',
        'render',
        projectId,
        '--frame-start',
        String(frameStart),
        '--frame-end',
        String(frameEnd),
        '--frame-capture-backend',
        frameCaptureBackend,
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
    completeShards: shards.filter((shard) => shard.status === DECK_FRAME_SHARD_COMPLETE_STATUS).length,
    duration: roundSeconds(frames.length / DEFAULT_DECK_RENDER_FPS),
    finalizeArgs: ['deck', 'render', projectId, '--finalize-only'],
    fps: DEFAULT_DECK_RENDER_FPS,
    frameCount: frames.length,
    frameManifestPath: `artifacts/${DECK_FRAME_MANIFEST_ARTIFACT_NAME}`,
    frameShardSize,
    generatedAt: new Date().toISOString(),
    outputDir: toProjectPath(workspace.projectDir, framesDir),
    partialShards: shards.filter((shard) => shard.status === DECK_FRAME_SHARD_PARTIAL_STATUS).length,
    pendingShards: shards.filter((shard) => shard.status === DECK_FRAME_SHARD_PENDING_STATUS).length,
    renderer: frameCaptureBackend,
    shards,
    source: TIMED_DECK_ARTIFACT_NAME,
    sourceSha256: timedDeckSourceSha256,
    version: 1 as const,
  }
  const artifactPath = await workspace.store.writeJson(DECK_FRAME_SHARD_PLAN_ARTIFACT_NAME, artifact)

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
