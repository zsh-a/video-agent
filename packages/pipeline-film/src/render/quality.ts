import type {FilmAudioMix, FilmSubtitleOutput, OutputNarration, OutputNarrationSegment} from '@video-agent/ir'
import type {TTSSegment} from '@video-agent/providers'
import type {QualityIssue} from '@video-agent/quality'

import {inspectAudioVolume, probeMedia} from '@video-agent/media'
import {FilmAudioMixSchema, FilmSubtitleOutputSchema, QUALITY_ERROR_SEVERITY, QUALITY_WARNING_SEVERITY, QualityIssueSeveritySchema} from '@video-agent/ir'
import {checkAudioLoudness, checkRenderedMedia, createAudioLoudnessProbeFailure, createRenderedMediaProbeFailure} from '@video-agent/quality'
import {z} from 'zod'

const QualityIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: QualityIssueSeveritySchema,
}).strict()

const FilmRenderQualitySectionSchema = z.object({
  errors: z.number().int().nonnegative(),
  issues: z.array(QualityIssueSchema).optional(),
  warnings: z.number().int().nonnegative(),
}).passthrough()

export const FilmRenderOutputArtifactSchema = z.object({
  audioQuality: FilmRenderQualitySectionSchema.optional(),
  outputQuality: FilmRenderQualitySectionSchema.optional(),
  subtitleQuality: FilmRenderQualitySectionSchema.optional(),
  visualQuality: FilmRenderQualitySectionSchema.optional(),
}).passthrough()

export type FilmRenderOutputArtifact = z.infer<typeof FilmRenderOutputArtifactSchema>

export function collectFilmRenderIssues(renderOutput: FilmRenderOutputArtifact): QualityIssue[] {
  return [
    ...(renderOutput.outputQuality?.issues ?? []),
    ...(renderOutput.subtitleQuality?.issues ?? []),
    ...(renderOutput.audioQuality?.issues ?? []),
    ...(renderOutput.visualQuality?.issues ?? []),
  ]
}

export function checkFilmTtsDurationBounds(outputNarration: OutputNarration, ttsSegments: TTSSegment[], outputDuration: number, tolerance = 0.05): QualityIssue[] {
  const narrationById = new Map(outputNarration.segments.map((segment) => [segment.id, segment]))
  const durationsByNarrationId = new Map<string, number>()
  const invalidDurationIssues: QualityIssue[] = []

  for (const ttsSegment of ttsSegments) {
    if (ttsSegment.duration <= 0 || !Number.isFinite(ttsSegment.duration)) {
      invalidDurationIssues.push({
        code: 'tts.segment.invalid_duration',
        message: `TTS audio for narration ${ttsSegment.narrationId} has invalid duration; no zero-duration TTS quality fallback is allowed.`,
        severity: QUALITY_ERROR_SEVERITY,
      })
      continue
    }

    durationsByNarrationId.set(ttsSegment.narrationId, (durationsByNarrationId.get(ttsSegment.narrationId) ?? 0) + ttsSegment.duration)
  }

  return [...invalidDurationIssues, ...[...durationsByNarrationId.entries()].flatMap(([narrationId, ttsDuration]): QualityIssue[] => {
    const segment = narrationById.get(narrationId)

    if (segment === undefined) {
      return []
    }

    const durationIssues: QualityIssue[] = []
    const narrationDuration = outputNarrationSegmentDuration(segment)

    if (ttsDuration > narrationDuration + tolerance) {
      durationIssues.push({
        code: 'tts.segment.exceeds_narration',
        message: `TTS audio for narration ${narrationId} exceeds the narration segment duration.`,
        severity: QUALITY_WARNING_SEVERITY,
      })
    }

    if (segment.start + ttsDuration > outputDuration + tolerance) {
      durationIssues.push({
        code: 'tts.segment.out_of_bounds',
        message: `TTS audio for narration ${narrationId} exceeds the rendered output duration.`,
        severity: QUALITY_WARNING_SEVERITY,
      })
    }

    return durationIssues
  })]
}

function outputNarrationSegmentDuration(segment: OutputNarrationSegment): number {
  return segment.end - segment.start
}

export async function readFilmAudioMix(valuePromise: Promise<unknown>): Promise<FilmAudioMix> {
  const value = await valuePromise

  return FilmAudioMixSchema.parse(value)
}

export async function readFilmSubtitles(valuePromise: Promise<unknown>): Promise<FilmSubtitleOutput> {
  const value = await valuePromise

  return FilmSubtitleOutputSchema.parse(value)
}

export async function inspectRenderedOutput(outputPath: string, options: {expectAudio: boolean; expectedDuration: number}) {
  try {
    return checkRenderedMedia(await probeMedia(outputPath), options)
  } catch (error) {
    return createRenderedMediaProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

export async function inspectRenderedAudio(outputPath: string) {
  try {
    return checkAudioLoudness(await inspectAudioVolume(outputPath))
  } catch (error) {
    return createAudioLoudnessProbeFailure(error instanceof Error ? error.message : String(error))
  }
}
