import type {DeckScriptTimingReport, SpeakerScript} from '@video-agent/ir'

import {DeckScriptTimingReportSchema} from '@video-agent/ir'

import {roundSeconds} from '../shared/utils.js'

const ENGLISH_WORDS_PER_SECOND = 2.6
const CJK_CHARACTERS_PER_SECOND = 4.8
const MAX_ESTIMATE_TO_PLAN_RATIO = 1.35
const ABSOLUTE_UNDERESTIMATE_GRACE_SECONDS = 1
const MAX_SLIDE_SECONDS = 14

export function createDeckScriptTimingReport(speakerScript: SpeakerScript): DeckScriptTimingReport {
  const segments = speakerScript.segments.map((segment) => {
    const plannedSeconds = segment.estimatedDuration ?? 0
    const words = countWords(segment.text)
    const textCharacters = [...segment.text].length
    const estimatedSpeechSeconds = estimateSpeechSeconds(segment.text, speakerScript.language)
    const issueCodes: string[] = []

    if (
      plannedSeconds > 0
      && estimatedSpeechSeconds / plannedSeconds > MAX_ESTIMATE_TO_PLAN_RATIO
      && estimatedSpeechSeconds - plannedSeconds > ABSOLUTE_UNDERESTIMATE_GRACE_SECONDS
    ) {
      issueCodes.push('deck.script_timing.underestimated')
    }

    if (plannedSeconds > MAX_SLIDE_SECONDS) {
      issueCodes.push('deck.script_timing.slide_too_long')
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
  const errors = segments.filter((segment) => segment.issueCodes.includes('deck.script_timing.underestimated')).length
  const warnings = segments.filter((segment) => segment.issueCodes.includes('deck.script_timing.slide_too_long')).length

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

  const first = report.segments.find((segment) => segment.issueCodes.includes('deck.script_timing.underestimated'))
  const detail = first === undefined
    ? ''
    : ` First underestimated speakerNote is ${first.slideId}: estimated ${first.estimatedSpeechSeconds}s for ${first.plannedSeconds}s.`

  throw new Error(`Deck speakerNote timing preflight found ${report.summary.errors} underestimated segment(s). Rewrite speakerNote text or duration before TTS.${detail}`)
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
