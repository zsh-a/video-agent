import type {ProjectWorkspace} from '@video-agent/runtime'

import {DECK_FRAME_MANIFEST_ARTIFACT_NAME, DECK_FRAME_SHARD_BATCH_ARTIFACT_NAME, DECK_FRAME_SHARD_PLAN_ARTIFACT_NAME, DECK_KEYFRAMES_ARTIFACT_NAME, RENDER_OUTPUT_ARTIFACT_NAME, REVIEW_REPORT_ARTIFACT_NAME, SUBTITLES_ARTIFACT_NAME} from '@video-agent/runtime'
import {readdir, rm} from 'node:fs/promises'
import {resolve} from 'node:path'

import {removeDeckReviewArtifacts} from '../../quality/review.js'

export async function removeDeckHtmlFrameArtifacts(workspace: ProjectWorkspace): Promise<void> {
  await Promise.all([
    rm(resolve(workspace.rendersDir, 'deck-frames'), {force: true, recursive: true}),
    rm(resolve(workspace.rendersDir, 'deck-keyframes'), {force: true, recursive: true}),
    rm(resolve(workspace.rendersDir, 'html'), {force: true, recursive: true}),
    rm(resolve(workspace.rendersDir, 'html-shards'), {force: true, recursive: true}),
    rm(resolve(workspace.rendersDir, 'review'), {force: true, recursive: true}),
  ])

  const artifactNames = await readDeckArtifactNames(workspace.artifactsDir)
  const staleArtifacts = artifactNames.filter((name) =>
    name === DECK_FRAME_MANIFEST_ARTIFACT_NAME
    || name === DECK_FRAME_SHARD_PLAN_ARTIFACT_NAME
    || name === DECK_FRAME_SHARD_BATCH_ARTIFACT_NAME
    || name === DECK_KEYFRAMES_ARTIFACT_NAME
    || name === REVIEW_REPORT_ARTIFACT_NAME
    || /^deck-frame-shard-\d{6}-\d{6}\.json$/.test(name),
  )

  await Promise.all(staleArtifacts.map((name) => rm(resolve(workspace.artifactsDir, name), {force: true})))
}

async function readDeckArtifactNames(artifactsDir: string): Promise<string[]> {
  try {
    return await readdir(artifactsDir)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

export async function removeDeckFinalRenderArtifacts(workspace: ProjectWorkspace): Promise<void> {
  await Promise.all([
    removeDeckReviewArtifacts(workspace),
    rm(resolve(workspace.rendersDir, 'deck-keyframes'), {force: true, recursive: true}),
    rm(resolve(workspace.rendersDir, 'deck_silent.mp4'), {force: true}),
    rm(resolve(workspace.rendersDir, 'final.mp4'), {force: true}),
    rm(resolve(workspace.rendersDir, 'subtitles.srt'), {force: true}),
    rm(workspace.store.resolve(DECK_KEYFRAMES_ARTIFACT_NAME), {force: true}),
    rm(workspace.store.resolve(RENDER_OUTPUT_ARTIFACT_NAME), {force: true}),
    rm(workspace.store.resolve(SUBTITLES_ARTIFACT_NAME), {force: true}),
  ])
}
