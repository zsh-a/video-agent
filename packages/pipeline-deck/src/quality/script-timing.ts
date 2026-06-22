import type {DeckScriptTimingReport, SpeakerScript} from '@video-agent/ir'

import {DeckScriptTimingReportSchema} from '@video-agent/ir'

import {roundSeconds} from '../shared/utils.js'

const ENGLISH_WORDS_PER_SECOND = 2.6
const CJK_CHARACTERS_PER_SECOND = 4.8
const MAX_TOTAL_ESTIMATE_TO_PLAN_RATIO = 1.35
const ABSOLUTE_TOTAL_UNDERESTIMATE_GRACE_SECONDS = 3
const SEGMENT_WARNING_ESTIMATE_TO_PLAN_RATIO = 1.75
const ABSOLUTE_SEGMENT_WARNING_GRACE_SECONDS = 4

export function createDeckScriptTimingReport(speakerScript: SpeakerScript): DeckScriptTimingReport {
  const segments = speakerScript.segments.map((segment, index) => {
    const plannedSeconds = requirePlannedSeconds(segment, index)
    const words = countWords(segment.text)
    const textCharacters = [...segment.text].length
    const estimatedSpeechSeconds = estimateSpeechSeconds(segment.text, speakerScript.language, index)
    const issueCodes: string[] = []

    if (
      plannedSeconds > 0
      && estimatedSpeechSeconds / plannedSeconds > SEGMENT_WARNING_ESTIMATE_TO_PLAN_RATIO
      && estimatedSpeechSeconds - plannedSeconds > ABSOLUTE_SEGMENT_WARNING_GRACE_SECONDS
    ) {
      issueCodes.push('deck.script_timing.segment_underestimated')
    }

    return {
      estimatedSpeechSeconds: roundSeconds(estimatedSpeechSeconds),
      issueCodes,
      plannedSeconds,
      slideId: segment.slideId,
      textCharacters,
      words,
    }
  })
  const plannedDuration = roundSeconds(segments.reduce((sum, segment) => sum + segment.plannedSeconds, 0))
  const estimatedSpeechDuration = roundSeconds(segments.reduce((sum, segment) => sum + segment.estimatedSpeechSeconds, 0))
  const totalUnderestimated = plannedDuration > 0
    && estimatedSpeechDuration / plannedDuration > MAX_TOTAL_ESTIMATE_TO_PLAN_RATIO
    && estimatedSpeechDuration - plannedDuration > ABSOLUTE_TOTAL_UNDERESTIMATE_GRACE_SECONDS
  const errors = totalUnderestimated ? 1 : 0
  const warnings = segments.filter((segment) => segment.issueCodes.includes('deck.script_timing.segment_underestimated')).length

  return DeckScriptTimingReportSchema.parse({
    checkedAt: new Date().toISOString(),
    estimatedSpeechDuration,
    plannedDuration,
    segments,
    summary: {
      errors,
      warnings,
    },
    version: 1,
  })
}

export function assertDeckScriptTiming(report: DeckScriptTimingReport): void {
  if (report.summary.errors === 0) {
    return
  }

  throw new Error(`Deck speakerNote timing preflight found estimated total speakerNote duration ${report.estimatedSpeechDuration}s for planned ${report.plannedDuration}s. Rewrite narration detail or deck durations before TTS.`)
}

function requirePlannedSeconds(segment: SpeakerScript['segments'][number], index: number): number {
  if (segment.estimatedDuration === undefined) {
    throw new Error(`Deck script timing report requires LLM-authored estimatedDuration for segment ${index + 1}; no zero-duration timing report fallback is allowed.`)
  }

  if (!Number.isFinite(segment.estimatedDuration) || segment.estimatedDuration <= 0) {
    throw new Error(`Deck script timing report requires positive estimatedDuration for segment ${index + 1}; no zero-duration timing report fallback is allowed.`)
  }

  return segment.estimatedDuration
}

function estimateSpeechSeconds(text: string, language: string, index: number): number {
  if (isCjkLanguage(language) || containsCjk(text)) {
    const characters = countCjkAwareCharacters(text)

    if (characters === 0) {
      throw new Error(`Deck script timing report segment ${index + 1} requires non-empty speech text; no minimum speech-duration fallback is allowed.`)
    }

    return characters / CJK_CHARACTERS_PER_SECOND
  }

  const words = countWords(text)

  if (words === 0) {
    throw new Error(`Deck script timing report segment ${index + 1} requires non-empty speech text; no minimum speech-duration fallback is allowed.`)
  }

  return words / ENGLISH_WORDS_PER_SECOND
}

function countWords(text: string): number {
  const words = text.trim().match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/gu)

  return words?.length ?? 0
}

function countCjkAwareCharacters(text: string): number {
  return [...text.replace(/\s+/gu, '')].length
}

function isCjkLanguage(language: string): boolean {
  return /^(zh|ja|ko)\b/iu.test(language)
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/u.test(text)
}
