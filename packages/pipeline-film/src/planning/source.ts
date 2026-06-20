import type {MediaInfo, SourceManifest} from '@video-agent/ir'

import {getOrientation, maxStreamDuration} from '../shared/utils.js'

export function createSourceManifest(mediaInfo: MediaInfo, sourceHash: string): SourceManifest {
  const video = mediaInfo.streams.find((stream) => stream.type === 'video')

  return {
    audioTracks: mediaInfo.streams.filter((stream) => stream.type === 'audio').length,
    codecName: video?.codecName,
    duration: mediaInfo.duration ?? maxStreamDuration(mediaInfo.streams) ?? 0,
    fps: video?.fps,
    height: video?.height,
    orientation: getOrientation(video),
    sourceHash,
    sourcePath: mediaInfo.inputPath,
    version: 1,
    width: video?.width,
  }
}
