import type {DeckTimingDriftReport, SpeakerScript} from '@video-agent/ir'
import type {TTSSegment} from '@video-agent/providers'

import {DeckTimingDriftReportSchema} from '@video-agent/ir'

import {roundSeconds} from '../shared/utils.js'
import {deckNarrationIdForIndex} from '../planning/timing.js'

const WARNING_DRIFT_RATIO = 1.35
const ERROR_DRIFT_RATIO = 1.8

export function createDeckTimingDriftReport(input: {
  speakerScript: SpeakerScript
  ttsSegments: TTSSegment[]
}): DeckTimingDriftReport {
  const ttsByNarrationId = new Map(input.ttsSegments.map((segment) => [segment.narrationId, segment]))
  const segments = input.speakerScript.segments.map((segment, index) => {
    const tts = ttsByNarrationId.get(deckNarrationIdForIndex(index))

    if (tts === undefined) {
      throw new Error(`Deck timing drift report is missing TTS output for slide "${segment.slideId}".`)
    }

    const plannedSeconds = segment.estimatedDuration ?? 0
    const ttsSeconds = tts.duration
    const driftRatio = plannedSeconds <= 0 ? Number.POSITIVE_INFINITY : ttsSeconds / plannedSeconds
    const issueCodes: string[] = []

    if (driftRatio > ERROR_DRIFT_RATIO) {
      issueCodes.push('deck.timing_drift.error')
    } else if (driftRatio > WARNING_DRIFT_RATIO) {
      issueCodes.push('deck.timing_drift.warning')
    }

    return {
      driftRatio: roundSeconds(driftRatio),
      issueCodes,
      plannedSeconds,
      slideId: segment.slideId,
      ttsSeconds,
    }
  })
  const plannedDuration = roundSeconds(segments.reduce((sum, segment) => sum + segment.plannedSeconds, 0))
  const totalDuration = roundSeconds(segments.reduce((sum, segment) => sum + segment.ttsSeconds, 0))
  const issueCodes = segments.flatMap((segment) => segment.issueCodes)

  return DeckTimingDriftReportSchema.parse({
    checkedAt: new Date().toISOString(),
    plannedDuration,
    segments,
    summary: {
      errors: issueCodes.filter((code) => code === 'deck.timing_drift.error').length,
      warnings: issueCodes.filter((code) => code === 'deck.timing_drift.warning').length,
    },
    totalDuration,
    version: 1,
  })
}

export function assertDeckTimingDrift(report: DeckTimingDriftReport): void {
  if (report.summary.errors === 0) {
    return
  }

  const first = report.segments.find((segment) => segment.issueCodes.includes('deck.timing_drift.error'))
  const detail = first === undefined
    ? ''
    : ` First drift: ${first.slideId} planned ${first.plannedSeconds}s, TTS ${first.ttsSeconds}s.`

  throw new Error(`Deck TTS timing drift exceeded repair limits for ${report.summary.errors} segment(s). Rewrite speaker-script before rendering.${detail}`)
}
