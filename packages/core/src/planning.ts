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
  const sourceDuration = requireSceneBoundaryDuration(transcript, mediaDuration)
  const segments = transcript?.segments ?? []

  if (segments.length === 0) {
    throw new Error('Scene boundary planning requires timed transcript segments; no transcript-wide fallback scene is allowed.')
  }

  const boundaries = segments.map((segment, index): SceneBoundaryInsight => {
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end > sourceDuration || segment.end <= segment.start) {
      throw new Error(`Scene boundary transcript segment ${index + 1} must provide a positive timestamp range within source duration; no segment clipping or filtering is allowed.`)
    }

    return {
      end: segment.end,
      id: `scene-${index + 1}`,
      start: segment.start,
      text: segment.text,
    }
  })

  return boundaries
}

export function createClipPlan(storyboard: Storyboard, mediaInfo: MediaInfo): ClipPlan {
  const sourceDuration = inferMediaDuration(mediaInfo)
  let duration = 0
  const clips: ClipPlan['clips'] = storyboard.scenes.map((scene, index) => {
    const {sourceRange} = scene
    if (sourceRange === undefined) {
      throw new Error(`Clip planning requires storyboard scene "${scene.id}" to include an explicit sourceRange.`)
    }

    const [sourceStart, sourceEnd] = sourceRange

    if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceStart < 0 || sourceEnd > sourceDuration || sourceEnd <= sourceStart) {
      throw new Error(`Clip planning requires storyboard scene "${scene.id}" sourceRange to stay within source duration; no runtime sourceRange clipping is allowed.`)
    }

    const clipDuration = sourceEnd - sourceStart

    duration = Math.max(duration, scene.start + clipDuration)

    return {
      duration: clipDuration,
      id: `clip-${index + 1}`,
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

function requireSceneBoundaryDuration(transcript: TranscriptInsight | undefined, mediaDuration: number): number {
  if (mediaDuration > 0) {
    return mediaDuration
  }

  const segmentEnd = Math.max(0, ...(transcript?.segments ?? []).map((segment) => segment.end))

  if (segmentEnd <= 0) {
    throw new Error('Scene boundary planning requires media duration or timed transcript segments.')
  }

  return segmentEnd
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
