import type {ClipPlan, MediaInfo, Narration, Storyboard, Timeline} from '@video-agent/ir'

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

export function createClipPlan(storyboard: Storyboard, mediaInfo: MediaInfo): ClipPlan {
  const sourceDuration = mediaInfo.duration ?? 0
  let duration = 0
  let sourceCursor = 0
  const clips: ClipPlan['clips'] = storyboard.scenes.map((scene, index) => {
    const sourceStart = sourceCursor
    const sourceEnd = clamp(sourceStart + scene.duration, sourceStart, sourceDuration)
    const clipDuration = sourceEnd - sourceStart

    sourceCursor = sourceEnd
    duration = Math.max(duration, scene.start + clipDuration)

    return {
      duration: clipDuration,
      id: `clip-${index + 1}`,
      reason: `Sequential source range for ${scene.id}; requested ${formatSeconds(scene.duration)}s, allocated ${formatSeconds(clipDuration)}s.`,
      sceneId: scene.id,
      source: mediaInfo.inputPath,
      sourceRange: [sourceStart, sourceEnd],
      start: scene.start,
    }
  })

  return {
    clips,
    duration,
    source: mediaInfo.inputPath,
    sourceDuration,
    version: 1,
  }
}

export function createTimelineFromClipPlan(mediaInfo: MediaInfo, clipPlan: ClipPlan): Timeline {
  const videoStream = mediaInfo.streams.find((stream) => stream.type === 'video')

  return {
    duration: clipPlan.duration,
    fps: videoStream?.fps ?? 30,
    items: clipPlan.clips.map((clip, index) => ({
      duration: clip.duration,
      id: `video-${index + 1}`,
      source: clip.source,
      sourceRange: clip.sourceRange,
      start: clip.start,
      track: 'video' as const,
    })),
    version: 1,
  }
}

export function createPlaceholderTimeline(mediaInfo: MediaInfo): Timeline {
  return createTimelineFromClipPlan(mediaInfo, createClipPlan(createPlaceholderStoryboard(mediaInfo), mediaInfo))
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
