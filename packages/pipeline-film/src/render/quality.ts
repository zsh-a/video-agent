import type {Narration} from '@video-agent/ir'
import type {TTSSegment} from '@video-agent/providers'
import type {QualityIssue} from '@video-agent/quality'
import type {FilmAudioMix, FilmSubtitleOutput} from '../shared/types.js'

import {inspectAudioVolume, probeMedia} from '@video-agent/media'
import {checkAudioLoudness, checkRenderedMedia, createAudioLoudnessProbeFailure, createRenderedMediaProbeFailure} from '@video-agent/quality'

export interface FilmRenderOutputArtifact {
  audioQuality?: {issues?: QualityIssue[]}
  outputQuality?: {issues?: QualityIssue[]}
  subtitleQuality?: {issues?: QualityIssue[]}
  visualQuality?: {issues?: QualityIssue[]}
}

export function collectFilmRenderIssues(renderOutput: FilmRenderOutputArtifact): QualityIssue[] {
  return [
    ...(renderOutput.outputQuality?.issues ?? []),
    ...(renderOutput.subtitleQuality?.issues ?? []),
    ...(renderOutput.audioQuality?.issues ?? []),
    ...(renderOutput.visualQuality?.issues ?? []),
  ]
}

export function checkFilmTtsDurationBounds(narration: Narration, ttsSegments: TTSSegment[], outputDuration: number, tolerance = 0.05): QualityIssue[] {
  const narrationById = new Map(narration.segments.map((segment) => [segment.id, segment]))
  const durationsByNarrationId = new Map<string, number>()

  for (const ttsSegment of ttsSegments) {
    durationsByNarrationId.set(ttsSegment.narrationId, (durationsByNarrationId.get(ttsSegment.narrationId) ?? 0) + Math.max(0, ttsSegment.duration))
  }

  return [...durationsByNarrationId.entries()].flatMap(([narrationId, ttsDuration]): QualityIssue[] => {
    const segment = narrationById.get(narrationId)

    if (segment?.start === undefined) {
      return []
    }

    const issues: QualityIssue[] = []

    if (segment.duration !== undefined && ttsDuration > segment.duration + tolerance) {
      issues.push({
        code: 'tts.segment.exceeds_narration',
        message: `TTS audio for narration ${narrationId} exceeds the narration segment duration.`,
        severity: 'warning',
      })
    }

    if (segment.start + ttsDuration > outputDuration + tolerance) {
      issues.push({
        code: 'tts.segment.out_of_bounds',
        message: `TTS audio for narration ${narrationId} exceeds the rendered output duration.`,
        severity: 'warning',
      })
    }

    return issues
  })
}

export async function readFilmAudioMix(valuePromise: Promise<unknown>): Promise<FilmAudioMix> {
  const value = await valuePromise

  return value as FilmAudioMix & {outputPath: string}
}

export async function readFilmSubtitles(valuePromise: Promise<unknown>): Promise<FilmSubtitleOutput> {
  const value = await valuePromise

  return value as FilmSubtitleOutput & {path: string}
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
