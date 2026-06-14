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

export function createStoryboardFromProviderInsights(
  mediaInfo: MediaInfo,
  options: {
    sceneAnalysis?: SceneAnalysisInsight[]
    targetPlatform?: Storyboard['targetPlatform']
    transcript?: TranscriptInsight
  },
): Storyboard {
  const transcriptSegments = createStoryboardSegments(options.transcript, mediaInfo.duration ?? 0)
  const scenes = transcriptSegments.map((segment, index) => {
    const id = `scene-${index + 1}`
    const analysis = findSceneAnalysis(options.sceneAnalysis ?? [], id, index)
    const transcriptText = normalizeText(segment.text) ?? normalizeText(options.transcript?.text)
    const visualText = normalizeText(analysis?.description)

    return {
      duration: segment.end - segment.start,
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
      id,
      narration: transcriptText ?? visualText ?? `Placeholder narration for ${id}.`,
      start: segment.start,
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

function createStoryboardSegments(transcript: TranscriptInsight | undefined, mediaDuration: number): Array<{end: number; start: number; text?: string}> {
  const sourceDuration = mediaDuration > 0 ? mediaDuration : inferTranscriptDuration(transcript)
  const segments = (transcript?.segments ?? [])
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

  if (segments.length > 0) {
    return segments
  }

  return [
    {
      end: sourceDuration,
      start: 0,
      text: transcript?.text,
    },
  ]
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

function normalizeText(value: string | undefined): string | undefined {
  const text = value?.trim()

  return text === undefined || text.length === 0 ? undefined : text
}
