import type {QualityIssue} from './timeline.js'

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
  maxEnd?: number
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
            severity: 'warning' as const,
          },
        ]),
    ...checkCueTiming(cues, options),
    ...cues.flatMap((cue): QualityIssue[] =>
      cue.text.trim() === ''
        ? [
            {
              code: 'subtitle.cue.empty_text',
              message: `Subtitle cue ${cue.index} has empty text.`,
              severity: 'warning',
            },
          ]
        : [],
    ),
  ]

  return {
    cues: cues.length,
    errors: issues.filter((issue) => issue.severity === 'error').length,
    issues,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

export function parseSrt(content: string): SubtitleCue[] {
  return content
    .trim()
    .split(/\r?\n\r?\n/)
    .filter((block) => block.trim() !== '')
    .map((block, index) => parseCue(block, index + 1))
}

function parseCue(block: string, fallbackIndex: number): SubtitleCue {
  const lines = block.split(/\r?\n/)
  const parsedIndex = Number(lines[0])
  const timeLine = lines[1] ?? ''
  const [startRaw, endRaw] = timeLine.split(/\s+-->\s+/)

  return {
    end: parseSrtTime(endRaw),
    index: Number.isInteger(parsedIndex) ? parsedIndex : fallbackIndex,
    start: parseSrtTime(startRaw),
    text: lines.slice(2).join('\n'),
  }
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
              severity: 'error' as const,
            },
          ]),
      ...(Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end <= cue.start
        ? [
            {
              code: 'subtitle.cue.non_positive_duration',
              message: `Subtitle cue ${cue.index} must end after it starts.`,
              severity: 'error' as const,
            },
          ]
        : []),
      ...(previous !== undefined && cue.start < previous.end - tolerance
        ? [
            {
              code: 'subtitle.cue.overlap',
              message: `Subtitle cue ${cue.index} overlaps cue ${previous.index}.`,
              severity: 'warning' as const,
            },
          ]
        : []),
      ...(options.maxEnd !== undefined && Number.isFinite(cue.end) && cue.end > options.maxEnd + tolerance
        ? [
            {
              code: 'subtitle.cue.out_of_bounds',
              message: `Subtitle cue ${cue.index} exceeds project duration.`,
              severity: 'error' as const,
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
