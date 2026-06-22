import type {QualityIssue} from './timeline.js'

import {QUALITY_ERROR_SEVERITY, QUALITY_WARNING_SEVERITY, countQualityIssues} from './issues.js'

export interface SubtitleCue {
  end: number
  index: number
  start: number
  text: string
}

export interface SubtitleQualityResult {
  cues: number
  errors: number
  issues: QualityIssue[]
  warnings: number
}

export interface SubtitleQualityOptions {
  expectedCues?: number
  maxLineCharacters?: number
  maxEnd?: number
  minCueDuration?: number
  timingTolerance?: number
}

export function checkSrtSubtitles(content: string, options: SubtitleQualityOptions = {}): SubtitleQualityResult {
  const cues = parseSrt(content)
  const issues = [
    ...(options.expectedCues === undefined || options.expectedCues === cues.length
      ? []
      : [
          {
            code: 'subtitle.cue_count.mismatch',
            message: `Subtitle cue count ${cues.length} does not match expected ${options.expectedCues}.`,
            severity: QUALITY_WARNING_SEVERITY,
          },
        ]),
    ...checkCueTiming(cues, options),
    ...checkCueReadability(cues, options),
    ...cues.flatMap((cue): QualityIssue[] =>
      cue.text.trim() === ''
        ? [
            {
              code: 'subtitle.cue.empty_text',
              message: `Subtitle cue ${cue.index} has empty text.`,
              severity: QUALITY_WARNING_SEVERITY,
            },
          ]
        : [],
    ),
  ]

  return {
    cues: cues.length,
    ...countQualityIssues(issues),
    issues,
  }
}

export function parseSrt(content: string): SubtitleCue[] {
  return content
    .trim()
    .split(/\r?\n\r?\n/)
    .filter((block) => block.trim() !== '')
    .map((block, index) => parseCue(block, index + 1))
}

function parseCue(block: string, defaultIndex: number): SubtitleCue {
  const lines = block.split(/\r?\n/)
  const parsedIndex = Number(lines[0])
  const timeLine = lines[1] ?? ''
  const [startRaw, endRaw] = timeLine.split(/\s+-->\s+/)

  return {
    end: parseSrtTime(endRaw),
    index: Number.isInteger(parsedIndex) ? parsedIndex : defaultIndex,
    start: parseSrtTime(startRaw),
    text: lines.slice(2).join('\n'),
  }
}

function checkCueReadability(cues: SubtitleCue[], options: SubtitleQualityOptions): QualityIssue[] {
  const minCueDuration = options.minCueDuration ?? 0.8
  const maxLineCharacters = options.maxLineCharacters ?? 42
  const issues: QualityIssue[] = []
  let shortCues = 0

  for (const cue of cues) {
    const duration = cue.end - cue.start

    if (Number.isFinite(duration) && duration > 0 && duration < minCueDuration) {
      shortCues += 1
      issues.push({
        code: 'subtitle.cue.too_short',
        message: `Subtitle cue ${cue.index} duration is ${duration.toFixed(3)}s; target is at least ${minCueDuration}s.`,
        severity: QUALITY_WARNING_SEVERITY,
      })
    }

    const longLine = cue.text.split('\n').find((line) => [...line].length > maxLineCharacters)

    if (longLine !== undefined) {
      issues.push({
        code: 'subtitle.line.too_long',
        message: `Subtitle cue ${cue.index} has a line with ${[...longLine].length} characters; target is ${maxLineCharacters} or fewer.`,
        severity: QUALITY_WARNING_SEVERITY,
      })
    }
  }

  if (cues.length > 0 && shortCues / cues.length > 0.15) {
    issues.push({
      code: 'subtitle.cue.too_many_short',
      message: `${shortCues} of ${cues.length} subtitle cues are shorter than ${minCueDuration}s.`,
      severity: QUALITY_WARNING_SEVERITY,
    })
  }

  return issues
}

function checkCueTiming(cues: SubtitleCue[], options: SubtitleQualityOptions): QualityIssue[] {
  const tolerance = options.timingTolerance ?? 0.05

  return cues.flatMap((cue, index): QualityIssue[] => {
    const previous = cues[index - 1]

    return [
      ...(Number.isFinite(cue.start) && Number.isFinite(cue.end)
        ? []
        : [
            {
              code: 'subtitle.cue.invalid_time',
              message: `Subtitle cue ${cue.index} has invalid timing.`,
              severity: QUALITY_ERROR_SEVERITY,
            },
          ]),
      ...(Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end <= cue.start
        ? [
            {
              code: 'subtitle.cue.non_positive_duration',
              message: `Subtitle cue ${cue.index} must end after it starts.`,
              severity: QUALITY_ERROR_SEVERITY,
            },
          ]
        : []),
      ...(previous !== undefined && cue.start < previous.end - tolerance
        ? [
            {
              code: 'subtitle.cue.overlap',
              message: `Subtitle cue ${cue.index} overlaps cue ${previous.index}.`,
              severity: QUALITY_WARNING_SEVERITY,
            },
          ]
        : []),
      ...(options.maxEnd !== undefined && Number.isFinite(cue.end) && cue.end > options.maxEnd + tolerance
        ? [
            {
              code: 'subtitle.cue.out_of_bounds',
              message: `Subtitle cue ${cue.index} exceeds project duration.`,
              severity: QUALITY_ERROR_SEVERITY,
            },
          ]
        : []),
    ]
  })
}

function parseSrtTime(value: string | undefined): number {
  if (value === undefined) {
    return Number.NaN
  }

  const match = /^(?<hours>\d{2}):(?<minutes>\d{2}):(?<seconds>\d{2}),(?<milliseconds>\d{3})$/.exec(value.trim())

  if (match?.groups === undefined) {
    return Number.NaN
  }

  return Number(match.groups.hours) * 3600 + Number(match.groups.minutes) * 60 + Number(match.groups.seconds) + Number(match.groups.milliseconds) / 1000
}
