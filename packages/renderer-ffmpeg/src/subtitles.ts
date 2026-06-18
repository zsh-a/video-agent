import type {Narration, NarrationSegment} from '@video-agent/ir'

export interface SrtCue {
  end: number
  index: number
  start: number
  text: string
}

const HARD_BREAK_PUNCTUATION = new Set(['。', '！', '？', '!', '?', ';', '；'])
const SOFT_BREAK_PUNCTUATION = new Set(['，', ',', '、', ':', '：'])
const DEFAULT_MAX_CUE_CHARS = 32
const DEFAULT_MAX_LINE_CHARS = 18
const MIN_SOFT_BREAK_CHARS = 10

export function narrationToSrt(narration: Narration): string {
  return `${narrationToSrtCues(narration).map(formatCue).join('\n\n')}\n`
}

export function narrationToSrtCues(narration: Narration): SrtCue[] {
  let index = 1

  return narration.segments.flatMap((segment) => {
    const cues = segmentToSrtCues(segment, index)

    index += cues.length

    return cues
  })
}

function segmentToSrtCues(segment: NarrationSegment, firstIndex: number): SrtCue[] {
  const start = segment.start ?? 0
  const chunks = splitSubtitleText(segment.text)
  const duration = segment.duration ?? Math.max(chunks.length, 1)
  const totalWeight = chunks.reduce((total, chunk) => total + subtitleWeight(chunk), 0) || 1
  let elapsed = 0

  return chunks.map((chunk, index) => {
    const cueStart = index === 0 ? start : roundMilliseconds(start + elapsed)

    elapsed += duration * (subtitleWeight(chunk) / totalWeight)

    const cueEnd = index === chunks.length - 1
      ? roundMilliseconds(start + duration)
      : Math.max(cueStart + 0.001, roundMilliseconds(start + elapsed))

    return {
      end: cueEnd,
      index: firstIndex + index,
      start: cueStart,
      text: wrapSubtitleText(chunk),
    }
  })
}

function formatCue(cue: SrtCue): string {
  return `${cue.index}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`
}

function splitSubtitleText(text: string): string[] {
  const normalized = normalizeSubtitleText(text)

  if (normalized === '') {
    return ['']
  }

  const chunks: string[] = []
  let current = ''

  for (const char of normalized) {
    current += char

    if (shouldBreakSubtitleChunk(current, char)) {
      chunks.push(current.trim())
      current = ''
    }
  }

  if (current.trim() !== '') {
    chunks.push(current.trim())
  }

  return chunks.flatMap((chunk) => splitOversizedChunk(chunk))
}

function shouldBreakSubtitleChunk(current: string, char: string): boolean {
  const length = current.trim().length

  if (length >= DEFAULT_MAX_CUE_CHARS) {
    return true
  }

  if (HARD_BREAK_PUNCTUATION.has(char) && length >= MIN_SOFT_BREAK_CHARS) {
    return true
  }

  return SOFT_BREAK_PUNCTUATION.has(char) && length >= DEFAULT_MAX_CUE_CHARS * 0.75
}

function splitOversizedChunk(chunk: string): string[] {
  if (chunk.length <= DEFAULT_MAX_CUE_CHARS) {
    return [chunk]
  }

  const chunks: string[] = []
  let rest = chunk

  while (rest.length > DEFAULT_MAX_CUE_CHARS) {
    const splitAt = findSubtitleSplitIndex(rest, DEFAULT_MAX_CUE_CHARS)

    chunks.push(rest.slice(0, splitAt).trim())
    rest = rest.slice(splitAt).trim()
  }

  if (rest !== '') {
    chunks.push(rest)
  }

  return chunks
}

function wrapSubtitleText(text: string): string {
  if (text.length <= DEFAULT_MAX_LINE_CHARS) {
    return text
  }

  const splitAt = findSubtitleSplitIndex(text, Math.ceil(text.length / 2))

  if (splitAt <= 0 || splitAt >= text.length) {
    return text
  }

  return `${text.slice(0, splitAt).trim()}\n${text.slice(splitAt).trim()}`
}

function findSubtitleSplitIndex(text: string, target: number): number {
  const min = Math.max(1, target - 8)
  const max = Math.min(text.length - 1, target + 8)

  for (let index = max; index >= min; index -= 1) {
    const char = text[index - 1]

    if (char !== undefined && (HARD_BREAK_PUNCTUATION.has(char) || SOFT_BREAK_PUNCTUATION.has(char))) {
      return index
    }
  }

  return Math.min(Math.max(target, 1), text.length - 1)
}

function normalizeSubtitleText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

function subtitleWeight(text: string): number {
  return Math.max(1, [...text].length)
}

function roundMilliseconds(seconds: number): number {
  return Math.round(seconds * 1000) / 1000
}

function formatSrtTime(seconds: number): string {
  const milliseconds = Math.floor(seconds * 1000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const remainingSeconds = Math.floor((milliseconds % 60_000) / 1000)
  const remainingMilliseconds = milliseconds % 1000

  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(remainingSeconds, 2)},${pad(remainingMilliseconds, 3)}`
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}
