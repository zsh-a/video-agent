import type {MediaInfo, Narration, Storyboard, Timeline} from '@video-agent/ir'

export function createPlaceholderStoryboard(mediaInfo: MediaInfo): Storyboard {
  const duration = mediaInfo.duration ?? 0

  return {
    language: 'zh-CN',
    scenes: [
      {
        duration,
        evidence: [],
        id: 'scene-1',
        narration: 'Placeholder narration. Replace this with generated script after provider integration.',
        start: 0,
        visualStyle: 'documentary',
      },
    ],
    targetPlatform: 'generic',
    version: 1,
  }
}

export function createPlaceholderTimeline(mediaInfo: MediaInfo): Timeline {
  const duration = mediaInfo.duration ?? 0
  const videoStream = mediaInfo.streams.find((stream) => stream.type === 'video')

  return {
    duration,
    fps: videoStream?.fps ?? 30,
    items: [
      {
        duration,
        id: 'video-1',
        source: mediaInfo.inputPath,
        sourceRange: [0, duration],
        start: 0,
        track: 'video',
      },
    ],
    version: 1,
  }
}

export function createPlaceholderNarration(storyboard: Storyboard): Narration {
  return {
    language: storyboard.language,
    segments: storyboard.scenes.map((scene, index) => ({
      duration: scene.duration,
      id: `narration-${index + 1}`,
      sceneId: scene.id,
      start: scene.start,
      text: scene.narration ?? `Placeholder narration for ${scene.id}.`,
    })),
    version: 1,
  }
}
