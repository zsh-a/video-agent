import type {MediaInfo} from '@video-agent/ir'

import type {QualityIssue} from './timeline.js'

export interface RenderedMediaQualityOptions {
  expectAudio?: boolean
  expectedDuration?: number
  timingTolerance?: number
}

export interface RenderedMediaQualityResult {
  audioStreams: number
  duration?: number
  errors: number
  issues: QualityIssue[]
  probed: boolean
  videoStreams: number
  warnings: number
}

export function checkRenderedMedia(mediaInfo: MediaInfo, options: RenderedMediaQualityOptions = {}): RenderedMediaQualityResult {
  const videoStreams = mediaInfo.streams.filter((stream) => stream.type === 'video').length
  const audioStreams = mediaInfo.streams.filter((stream) => stream.type === 'audio').length
  const issues = [
    ...(videoStreams > 0
      ? []
      : [
          {
            code: 'render.output.missing_video',
            message: 'Rendered output does not contain a video stream.',
            severity: 'error' as const,
          },
        ]),
    ...(options.expectAudio !== true || audioStreams > 0
      ? []
      : [
          {
            code: 'render.output.missing_audio',
            message: 'Rendered output was expected to contain audio but no audio stream was found.',
            severity: 'warning' as const,
          },
        ]),
    ...checkDuration(mediaInfo, options),
  ]

  return {
    audioStreams,
    ...(mediaInfo.duration === undefined ? {} : {duration: mediaInfo.duration}),
    errors: issues.filter((issue) => issue.severity === 'error').length,
    issues,
    probed: true,
    videoStreams,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

export function createRenderedMediaProbeFailure(message: string): RenderedMediaQualityResult {
  const issues: QualityIssue[] = [
    {
      code: 'render.output.probe_failed',
      message,
      severity: 'warning',
    },
  ]

  return {
    audioStreams: 0,
    errors: 0,
    issues,
    probed: false,
    videoStreams: 0,
    warnings: 1,
  }
}

function checkDuration(mediaInfo: MediaInfo, options: RenderedMediaQualityOptions): QualityIssue[] {
  if (options.expectedDuration === undefined) {
    return []
  }

  if (mediaInfo.duration === undefined) {
    return [
      {
        code: 'render.output.missing_duration',
        message: 'Rendered output duration could not be read.',
        severity: 'warning',
      },
    ]
  }

  if (Math.abs(mediaInfo.duration - options.expectedDuration) <= (options.timingTolerance ?? 0.2)) {
    return []
  }

  return [
    {
      code: 'render.output.duration_mismatch',
      message: `Rendered output duration ${mediaInfo.duration} differs from expected ${options.expectedDuration}.`,
      severity: 'warning',
    },
  ]
}
