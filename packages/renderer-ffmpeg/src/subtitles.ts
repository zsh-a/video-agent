import type {Narration, NarrationSegment} from '@video-agent/ir'

export function narrationToSrt(narration: Narration): string {
  return `${narration.segments.map((segment, index) => formatCue(segment, index)).join('\n\n')}\n`
}

function formatCue(segment: NarrationSegment, index: number): string {
  const start = segment.start ?? 0
  const end = start + (segment.duration ?? 1)

  return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${segment.text}`
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
