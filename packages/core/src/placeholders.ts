import type {ClipPlan, MediaInfo, Narration, Storyboard, Timeline} from '@video-agent/ir'

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

export interface SceneAnalysisInsight {
  description?: string
  evidence?: string[]
  sceneId?: string
}

export interface SceneBoundaryInsight {
  end: number
  id: string
  start: number
  text?: string
}

export function createPlaceholderStoryboard(mediaInfo: MediaInfo): Storyboard {
  const duration = inferMediaDuration(mediaInfo)

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

export function createStoryboardFromProviderInsights(
  mediaInfo: MediaInfo,
  options: {
    sceneAnalysis?: SceneAnalysisInsight[]
    targetPlatform?: Storyboard['targetPlatform']
    transcript?: TranscriptInsight
  },
): Storyboard {
  const boundaries = createSceneBoundariesFromTranscript(options.transcript, inferMediaDuration(mediaInfo))
  const scenes = boundaries.map((boundary, index) => {
    const analysis = findSceneAnalysis(options.sceneAnalysis ?? [], boundary.id, index)
    const transcriptText = normalizeText(boundary.text) ?? normalizeText(options.transcript?.text)
    const visualText = normalizeText(analysis?.description)

    return {
      duration: boundary.end - boundary.start,
      evidence: [
        ...(transcriptText === undefined
          ? []
          : [
              {
                ref: 'transcript.json',
                text: transcriptText,
                type: 'asr' as const,
              },
            ]),
        ...(visualText === undefined
          ? []
          : [
              {
                ref: 'scene-analysis.json',
                text: visualText,
                type: 'vlm' as const,
              },
            ]),
      ],
      id: boundary.id,
      narration: transcriptText ?? visualText ?? `Placeholder narration for ${boundary.id}.`,
      sourceRange: [boundary.start, boundary.end] as [number, number],
      start: boundary.start,
      visualStyle: 'documentary',
    }
  })

  return {
    language: options.transcript?.language ?? 'zh-CN',
    scenes,
    targetPlatform: options.targetPlatform ?? 'generic',
    version: 1,
  }
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

export function createPlaceholderTimeline(mediaInfo: MediaInfo): Timeline {
  return createTimelineFromClipPlan(mediaInfo, createClipPlan(createPlaceholderStoryboard(mediaInfo), mediaInfo))
}

export function createNarrationFromClipPlan(storyboard: Storyboard, clipPlan: ClipPlan): Narration {
  const clipsBySceneId = new Map(clipPlan.clips.map((clip) => [clip.sceneId, clip]))

  return {
    language: storyboard.language,
    segments: storyboard.scenes.map((scene, index) => {
      const clip = clipsBySceneId.get(scene.id)

      return {
        duration: clip?.duration ?? scene.duration,
        id: `narration-${index + 1}`,
        sceneId: scene.id,
        start: clip?.start ?? scene.start,
        text: scene.narration ?? `Placeholder narration for ${scene.id}.`,
      }
    }),
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function findSceneAnalysis(sceneAnalysis: SceneAnalysisInsight[], sceneId: string, index: number): SceneAnalysisInsight | undefined {
  return sceneAnalysis.find((scene) => scene.sceneId === sceneId) ?? sceneAnalysis[index]
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

function normalizeText(value: string | undefined): string | undefined {
  const text = value?.trim()

  return text === undefined || text.length === 0 ? undefined : text
}
