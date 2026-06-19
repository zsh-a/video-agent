import type {ProjectWorkspace} from '@video-agent/runtime'

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

  const artifactNames = await readdir(workspace.artifactsDir).catch(() => [])
  const staleArtifacts = artifactNames.filter((name) =>
    name === 'deck-frame-manifest.json'
    || name === 'deck-frame-shard-plan.json'
    || name === 'deck-frame-shard-batch.json'
    || name === 'deck-keyframes.json'
    || name === 'review-report.json'
    || /^deck-frame-shard-\d{6}-\d{6}\.json$/.test(name),
  )

  await Promise.all(staleArtifacts.map((name) => rm(resolve(workspace.artifactsDir, name), {force: true})))
}

export async function removeDeckFinalRenderArtifacts(workspace: ProjectWorkspace): Promise<void> {
  await Promise.all([
    removeDeckReviewArtifacts(workspace),
    rm(resolve(workspace.rendersDir, 'deck-keyframes'), {force: true, recursive: true}),
    rm(resolve(workspace.rendersDir, 'deck_silent.mp4'), {force: true}),
    rm(resolve(workspace.rendersDir, 'final.mp4'), {force: true}),
    rm(resolve(workspace.rendersDir, 'subtitles.srt'), {force: true}),
    rm(workspace.store.resolve('deck-keyframes.json'), {force: true}),
    rm(workspace.store.resolve('render-output.json'), {force: true}),
    rm(workspace.store.resolve('subtitles.json'), {force: true}),
  ])
}
