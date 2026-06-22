import type {MediaInfo} from '@video-agent/ir'

import {probeMedia} from '@video-agent/media'
import {access} from 'node:fs/promises'
import {resolve} from 'node:path'

import {MEDIA_INFO_ARTIFACT_NAME} from '../artifacts/artifact-names.js'
import {createProjectWorkspace} from '../shared/workspace.js'

export interface InspectMediaProjectOptions {
  projectId?: string
  workspaceDir?: string
}

export interface InspectMediaProjectResult {
  artifactPath: string
  duration?: number
  inputPath: string
  mediaInfo: MediaInfo
  projectDir: string
  projectId: string
  streams: number
}

export async function inspectMediaProject(input: string, options: InspectMediaProjectOptions = {}): Promise<InspectMediaProjectResult> {
  const inputPath = resolve(input)

  await access(inputPath)

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const mediaInfo = await probeMedia(inputPath)
  const artifactPath = await workspace.store.writeJson(MEDIA_INFO_ARTIFACT_NAME, mediaInfo)

  return {
    artifactPath,
    duration: mediaInfo.duration,
    inputPath,
    mediaInfo,
    projectDir: workspace.projectDir,
    projectId: workspace.projectId,
    streams: mediaInfo.streams.length,
  }
}
