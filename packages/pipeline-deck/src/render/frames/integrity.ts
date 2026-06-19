import type {CaptureDeckHtmlFrameSequenceResult} from '@video-agent/renderer-html'

import {bunFile} from '@video-agent/runtime'
import {createHash} from 'node:crypto'
import {stat} from 'node:fs/promises'

import {resolveProjectPath, toProjectPath} from '../../project/paths.js'

export async function assertCompleteDeckFrameSequence(projectDir: string, frames: CaptureDeckHtmlFrameSequenceResult['frames']): Promise<void> {
  const missingFrames = await findMissingDeckFrameFiles(projectDir, frames)

  if (missingFrames.length === 0) {
    return
  }

  const examples = missingFrames
    .slice(0, 5)
    .map((frame) => `${frame.frame}:${toProjectPath(projectDir, frame.path)}`)
    .join(', ')

  throw new Error(`Deck frame sequence is incomplete: ${missingFrames.length} missing or empty frame(s). First missing frames: ${examples}`)
}

export async function findMissingDeckFrameFiles(projectDir: string, frames: CaptureDeckHtmlFrameSequenceResult['frames']): Promise<Array<{frame: number; path: string}>> {
  const missing: Array<{frame: number; path: string}> = []

  for (const frame of frames) {
    const path = resolveProjectPath(projectDir, frame.path)

    try {
      // eslint-disable-next-line no-await-in-loop
      const info = await stat(path)

      if (info.size <= 0) {
        missing.push({frame: frame.frame, path})
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        missing.push({frame: frame.frame, path})
        continue
      }

      throw error
    }
  }

  return missing
}

export async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await bunFile(path).bytes()).digest('hex')
}
