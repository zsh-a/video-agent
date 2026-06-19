import type {Narration} from '@video-agent/ir'
import type {SubtitleQualityResult} from '@video-agent/quality'
import type {ProjectWorkspace} from './workspace.js'

import {NarrationSchema} from '@video-agent/ir'
import {checkSrtSubtitles} from '@video-agent/quality'
import {narrationToSrt} from '@video-agent/renderer-ffmpeg'
import {resolve} from 'node:path'

import {bunFile, bunWrite} from './bun-runtime.js'

export async function writeSubtitlesIfAvailable(workspace: ProjectWorkspace): Promise<string | undefined> {
  const narration = await readNarrationIfAvailable(workspace)

  if (narration === undefined) {
    return undefined
  }

  const subtitlePath = resolve(workspace.rendersDir, 'subtitles.srt')

  await bunWrite(subtitlePath, narrationToSrt(narration))

  return subtitlePath
}

export async function inspectSubtitleFile(subtitlePath: string, workspace: ProjectWorkspace, maxEnd: number): Promise<SubtitleQualityResult> {
  const narration = await readNarrationIfAvailable(workspace)

  return checkSrtSubtitles(await bunFile(subtitlePath).text(), {
    expectedCues: narration?.segments.length,
    maxEnd,
  })
}

export async function readNarrationIfAvailable(workspace: ProjectWorkspace): Promise<Narration | undefined> {
  try {
    return NarrationSchema.parse(await workspace.store.readJson('narration.json'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}
