import type {Narration, Timeline} from '@video-agent/ir'

import type {QualityIssue} from './timeline.js'

export interface TtsAlignmentSegment {
  duration: number
  narrationId: string
  path: string
}

export interface NarrationQualityOptions {
  timingTolerance?: number
}

export function checkNarrationTiming(narration: Narration, timeline: Timeline, options: NarrationQualityOptions = {}): QualityIssue[] {
  const tolerance = options.timingTolerance ?? 0.05
  const timedSegments = narration.segments
    .map((segment, index) => ({
      duration: segment.duration,
      id: segment.id,
      index,
      start: segment.start,
    }))
    .filter((segment): segment is {duration: number; id: string; index: number; start: number} => segment.start !== undefined && segment.duration !== undefined)
    .sort((left, right) => left.start - right.start)

  return [
    ...narration.segments.flatMap((segment): QualityIssue[] => [
      ...(segment.start === undefined
        ? [
            {
              code: 'narration.segment.missing_start',
              message: `Narration segment ${segment.id} does not define a start time.`,
              severity: 'warning' as const,
            },
          ]
        : []),
      ...(segment.duration === undefined
        ? [
            {
              code: 'narration.segment.missing_duration',
              message: `Narration segment ${segment.id} does not define a duration.`,
              severity: 'warning' as const,
            },
          ]
        : []),
      ...(segment.start !== undefined && segment.duration !== undefined && segment.start + segment.duration > timeline.duration + tolerance
        ? [
            {
              code: 'narration.segment.out_of_bounds',
              message: `Narration segment ${segment.id} exceeds project duration.`,
              severity: 'error' as const,
            },
          ]
        : []),
    ]),
    ...timedSegments.slice(1).flatMap((segment, index): QualityIssue[] => {
      const previous = timedSegments[index]

      if (previous === undefined || segment.start >= previous.start + previous.duration - tolerance) {
        return []
      }

      return [
        {
          code: 'narration.segment.overlap',
          message: `Narration segment ${segment.id} overlaps ${previous.id}.`,
          severity: 'warning',
        },
      ]
    }),
  ]
}

export function checkTtsCoverage(narration: Narration, ttsSegments: TtsAlignmentSegment[], options: NarrationQualityOptions = {}): QualityIssue[] {
  const tolerance = options.timingTolerance ?? 0.05
  const narrationIds = new Set(narration.segments.map((segment) => segment.id))
  const ttsByNarrationId = new Map<string, TtsAlignmentSegment[]>()

  for (const segment of ttsSegments) {
    const segments = ttsByNarrationId.get(segment.narrationId) ?? []

    segments.push(segment)
    ttsByNarrationId.set(segment.narrationId, segments)
  }

  return [
    ...ttsSegments.flatMap((segment): QualityIssue[] => [
      ...(narrationIds.has(segment.narrationId)
        ? []
        : [
            {
              code: 'tts.segment.unknown_narration',
              message: `TTS segment ${segment.path} references unknown narration ${segment.narrationId}.`,
              severity: 'warning' as const,
            },
          ]),
      ...(segment.duration > 0
        ? []
        : [
            {
              code: 'tts.segment.invalid_duration',
              message: `TTS segment ${segment.path} has a non-positive duration.`,
              severity: 'warning' as const,
            },
          ]),
      ...(segment.path.trim() === ''
        ? [
            {
              code: 'tts.segment.missing_path',
              message: `TTS segment for narration ${segment.narrationId} does not define an audio path.`,
              severity: 'warning' as const,
            },
          ]
        : []),
    ]),
    ...narration.segments.flatMap((segment): QualityIssue[] => {
      const matchingTtsSegments = ttsByNarrationId.get(segment.id) ?? []

      if (matchingTtsSegments.length === 0) {
        return [
          {
            code: 'tts.segment.missing',
            message: `Narration segment ${segment.id} has no TTS audio segment.`,
            severity: 'warning',
          },
        ]
      }

      if (segment.duration === undefined) {
        return []
      }

      const ttsDuration = matchingTtsSegments.reduce((sum, ttsSegment) => sum + Math.max(0, ttsSegment.duration), 0)

      if (ttsDuration === 0 || Math.abs(ttsDuration - segment.duration) <= tolerance) {
        return []
      }

      return [
        {
          code: 'tts.duration.mismatch',
          message: `TTS duration for narration ${segment.id} differs from narration timing.`,
          severity: 'warning',
        },
      ]
    }),
  ]
}
