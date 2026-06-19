import type {MediaInfo, SourceManifest} from '@video-agent/ir'

import {clamp, getOrientation, maxStreamDuration, roundSeconds} from './film-utils.js'

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

export function defaultRecapTargetDuration(sourceDuration: number): number {
  if (sourceDuration <= 0) {
    return 0
  }

  if (sourceDuration <= 90) {
    return sourceDuration
  }

  return roundSeconds(clamp(sourceDuration * 0.6, 90, 300))
}
