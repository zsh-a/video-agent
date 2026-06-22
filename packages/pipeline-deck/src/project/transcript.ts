import type {Transcript, TranscriptSegment} from '@video-agent/providers'

export function requireExactTranscriptSegments(transcript: Transcript, context: string): TranscriptSegment[] {
  if (transcript.segments.length === 0) {
    throw new Error(`${context} requires non-empty timed ASR transcript segments; no default timing fallback is allowed.`)
  }

  transcript.segments.forEach((segment, index) => {
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start) {
      throw new Error(`${context} ASR transcript segment ${index + 1} has an invalid timestamp range; no silent segment filtering is allowed.`)
    }

    if (segment.text.trim() === '') {
      throw new Error(`${context} ASR transcript segment ${index + 1} is empty; no silent segment filtering is allowed.`)
    }
  })

  return transcript.segments
}

export function requireExactTranscriptText(transcript: Transcript, context: string): string {
  if (transcript.text.trim() === '') {
    throw new Error(`${context} requires explicit ASR transcript text; no segment-text transcript reconstruction fallback is allowed.`)
  }

  return transcript.text
}

export function requireTranscriptLanguage(transcript: Transcript, context: string): string {
  if (transcript.language === undefined) {
    throw new Error(`${context} requires explicit ASR transcript language; no target.language auto fallback is allowed.`)
  }

  if (transcript.language !== transcript.language.trim() || transcript.language.trim() === '') {
    throw new Error(`${context} ASR transcript language must be a clean non-empty language tag; no runtime language cleanup fallback is allowed.`)
  }

  if (['auto', 'unknown', 'und', 'undefined'].includes(transcript.language.toLowerCase())) {
    throw new Error(`${context} ASR transcript language "${transcript.language}" is not concrete; no target.language auto fallback is allowed.`)
  }

  return transcript.language
}
