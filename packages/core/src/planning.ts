import type {ClipPlan, MediaInfo, Storyboard, Timeline} from '@video-agent/ir'

export interface TranscriptInsight {
  language?: string
  segments?: TranscriptSegmentInsight[]
  text?: string
}

export interface TranscriptSegmentInsight {
  end: number
  start: number
  text?: string
}

export interface SceneBoundaryInsight {
  end: number
  id: string
  start: number
  text?: string
}

export function createSceneBoundariesFromTranscript(transcript: TranscriptInsight | undefined, mediaDuration: number): SceneBoundaryInsight[] {
  const sourceDuration = mediaDuration > 0 ? mediaDuration : inferTranscriptDuration(transcript)
  const validSegments = (transcript?.segments ?? [])
    .map((segment) => {
      const start = clamp(segment.start, 0, sourceDuration)
      const end = clamp(segment.end, start, sourceDuration)

      return {
        end,
        start,
        text: segment.text,
      }
    })
    .filter((segment) => segment.end > segment.start)
  const boundaries = validSegments.map((segment, index): SceneBoundaryInsight => ({
    ...segment,
    id: `scene-${index + 1}`,
  }))

  if (boundaries.length > 0) {
    return boundaries
  }

  return [
    {
      end: sourceDuration,
      id: 'scene-1',
      start: 0,
      text: transcript?.text,
    },
  ]
}

export function createClipPlan(storyboard: Storyboard, mediaInfo: MediaInfo): ClipPlan {
  const sourceDuration = inferMediaDuration(mediaInfo)
  let duration = 0
  let sourceCursor = 0
  const clips: ClipPlan['clips'] = storyboard.scenes.map((scene, index) => {
    const {sourceRange} = scene
    const sourceStart = sourceRange === undefined ? sourceCursor : clamp(sourceRange[0], 0, sourceDuration)
    const sourceEnd = sourceRange === undefined ? clamp(sourceStart + scene.duration, sourceStart, sourceDuration) : clamp(sourceRange[1], sourceStart, sourceDuration)
    const clipDuration = sourceEnd - sourceStart

    sourceCursor = Math.max(sourceCursor, sourceEnd)
    duration = Math.max(duration, scene.start + clipDuration)

    return {
      duration: clipDuration,
      id: `clip-${index + 1}`,
      reason: sourceRange === undefined
        ? `Sequential source range for ${scene.id}; requested ${formatSeconds(scene.duration)}s, allocated ${formatSeconds(clipDuration)}s.`
        : `Storyboard source range for ${scene.id}; requested ${formatSeconds(sourceRange[1] - sourceRange[0])}s, allocated ${formatSeconds(clipDuration)}s.`,
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function inferTranscriptDuration(transcript: TranscriptInsight | undefined): number {
  const segmentEnd = Math.max(0, ...(transcript?.segments ?? []).map((segment) => segment.end))

  return segmentEnd > 0 ? segmentEnd : 1
}

function inferMediaDuration(mediaInfo: MediaInfo): number {
  if (mediaInfo.duration !== undefined) {
    return mediaInfo.duration
  }

  const streamDurations = mediaInfo.streams
    .map((stream) => stream.duration)
    .filter((duration): duration is number => duration !== undefined)

  return streamDurations.length === 0 ? 0 : Math.max(...streamDurations)
}
