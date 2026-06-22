import type {MediaInfo, SourceManifest} from '@video-agent/ir'

import {getOrientation, maxStreamDuration} from '../shared/utils.js'

export function createSourceManifest(mediaInfo: MediaInfo, sourceHash: string): SourceManifest {
  const video = mediaInfo.streams.find((stream) => stream.type === 'video')
  const duration = resolveSourceDuration(mediaInfo)

  return {
    audioTracks: mediaInfo.streams.filter((stream) => stream.type === 'audio').length,
    codecName: video?.codecName,
    duration,
    fps: video?.fps,
    height: video?.height,
    orientation: getOrientation(video),
    sourceHash,
    sourcePath: mediaInfo.inputPath,
    version: 1,
    width: video?.width,
  }
}

function resolveSourceDuration(mediaInfo: MediaInfo): number {
  if (mediaInfo.duration !== undefined) {
    if (Number.isFinite(mediaInfo.duration) && mediaInfo.duration > 0) {
      return mediaInfo.duration
    }

    throw new Error('Film source manifest requires a positive media duration; no zero-duration source fallback is allowed.')
  }

  const streamDuration = maxStreamDuration(mediaInfo.streams)

  if (streamDuration !== undefined && Number.isFinite(streamDuration) && streamDuration > 0) {
    return streamDuration
  }

  throw new Error('Film source manifest requires media or stream duration from probing; no zero-duration source fallback is allowed.')
}
