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
  const segments = speakerScript.segments.map((segment) => {
    const plannedSeconds = segment.estimatedDuration ?? 0
    const words = countWords(segment.text)
    const textCharacters = [...segment.text].length
    const estimatedSpeechSeconds = estimateSpeechSeconds(segment.text, speakerScript.language)
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

function estimateSpeechSeconds(text: string, language: string): number {
  if (isCjkLanguage(language) || containsCjk(text)) {
    return Math.max(1, countCjkAwareCharacters(text) / CJK_CHARACTERS_PER_SECOND)
  }

  return Math.max(1, countWords(text) / ENGLISH_WORDS_PER_SECOND)
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
