import type {Timeline} from '@video-agent/ir'

import type {QualityIssue} from './timeline.js'

import {QUALITY_ERROR_SEVERITY, QUALITY_WARNING_SEVERITY} from './issues.js'

export interface TtsAlignmentSegment {
  duration: number
  narrationId: string
  path: string
}

export interface NarrationTimingInput {
  segments: NarrationTimingSegment[]
}

export interface NarrationTimingSegment {
  duration?: number
  end?: number
  id: string
  start?: number
}

export interface NarrationQualityOptions {
  timingTolerance?: number
}

export function checkNarrationTiming(narration: NarrationTimingInput, timeline: Timeline, options: NarrationQualityOptions = {}): QualityIssue[] {
  const tolerance = options.timingTolerance ?? 0.05
  const timedSegments = narration.segments
    .map((segment, index) => ({
      duration: resolveNarrationSegmentDuration(segment),
      id: segment.id,
      index,
      start: segment.start,
    }))
    .filter((segment): segment is {duration: number; id: string; index: number; start: number} => segment.start !== undefined && segment.duration !== undefined)
    .sort((left, right) => left.start - right.start)

  return [
    ...narration.segments.flatMap((segment) => checkNarrationSegmentTiming(segment, timeline.duration, tolerance)),
    ...timedSegments.slice(1).flatMap((segment, index): QualityIssue[] => {
      const previous = timedSegments[index]

      if (previous === undefined || segment.start >= previous.start + previous.duration - tolerance) {
        return []
      }

      return [
        {
          code: 'narration.segment.overlap',
          message: `Narration segment ${segment.id} overlaps ${previous.id}.`,
          severity: QUALITY_WARNING_SEVERITY,
        },
      ]
    }),
  ]
}

function checkNarrationSegmentTiming(segment: NarrationTimingSegment, timelineDuration: number, tolerance: number): QualityIssue[] {
  const duration = resolveNarrationSegmentDuration(segment)

  return [
    ...(segment.start === undefined
      ? [
          {
            code: 'narration.segment.missing_start',
            message: `Narration segment ${segment.id} does not define a start time.`,
            severity: QUALITY_WARNING_SEVERITY,
          },
        ]
      : []),
    ...(duration === undefined
      ? [
          {
            code: 'narration.segment.missing_duration',
            message: `Narration segment ${segment.id} does not define a duration.`,
            severity: QUALITY_WARNING_SEVERITY,
          },
        ]
      : []),
    ...(segment.start !== undefined && duration !== undefined && segment.start + duration > timelineDuration + tolerance
      ? [
          {
            code: 'narration.segment.out_of_bounds',
            message: `Narration segment ${segment.id} exceeds project duration.`,
            severity: QUALITY_ERROR_SEVERITY,
          },
        ]
      : []),
  ]
}

export function checkTtsCoverage(narration: NarrationTimingInput, ttsSegments: TtsAlignmentSegment[], options: NarrationQualityOptions = {}): QualityIssue[] {
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
              severity: QUALITY_WARNING_SEVERITY,
            },
          ]),
      ...(segment.duration > 0
        ? []
        : [
            {
              code: 'tts.segment.invalid_duration',
              message: `TTS segment ${segment.path} has a non-positive duration.`,
              severity: QUALITY_WARNING_SEVERITY,
            },
          ]),
      ...(segment.path.trim() === ''
        ? [
            {
              code: 'tts.segment.missing_path',
              message: `TTS segment for narration ${segment.narrationId} does not define an audio path.`,
              severity: QUALITY_WARNING_SEVERITY,
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
            severity: QUALITY_WARNING_SEVERITY,
          },
        ]
      }

      const narrationDuration = resolveNarrationSegmentDuration(segment)

      if (narrationDuration === undefined) {
        return []
      }

      const ttsDuration = matchingTtsSegments.reduce((sum, ttsSegment) => (
        Number.isFinite(ttsSegment.duration) && ttsSegment.duration > 0
          ? sum + ttsSegment.duration
          : sum
      ), 0)

      if (ttsDuration === 0 || Math.abs(ttsDuration - narrationDuration) <= tolerance) {
        return []
      }

      return [
        {
          code: 'tts.duration.mismatch',
          message: `TTS duration for narration ${segment.id} differs from narration timing.`,
          severity: QUALITY_WARNING_SEVERITY,
        },
      ]
    }),
  ]
}

function resolveNarrationSegmentDuration(segment: NarrationTimingSegment): number | undefined {
  if (segment.duration !== undefined) {
    return segment.duration
  }

  if (segment.start !== undefined && segment.end !== undefined) {
    return segment.end - segment.start
  }

  return undefined
}
