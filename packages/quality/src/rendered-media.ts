import type {MediaInfo} from '@video-agent/ir'

import type {QualityIssue} from './timeline.js'

import {QUALITY_ERROR_SEVERITY, QUALITY_WARNING_SEVERITY, countQualityIssues} from './issues.js'

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
  subtitleStreams: number
  videoStreams: number
  warnings: number
}

export function checkRenderedMedia(mediaInfo: MediaInfo, options: RenderedMediaQualityOptions = {}): RenderedMediaQualityResult {
  const videoStreams = mediaInfo.streams.filter((stream) => stream.type === 'video').length
  const audioStreams = mediaInfo.streams.filter((stream) => stream.type === 'audio').length
  const subtitleStreams = mediaInfo.streams.filter((stream) => stream.type === 'subtitle').length
  const issues = [
    ...(videoStreams > 0
      ? []
      : [
          {
            code: 'render.output.missing_video',
            message: 'Rendered output does not contain a video stream.',
            severity: QUALITY_ERROR_SEVERITY,
          },
        ]),
    ...(options.expectAudio !== true || audioStreams > 0
      ? []
      : [
          {
            code: 'render.output.missing_audio',
            message: 'Rendered output was expected to contain audio but no audio stream was found.',
            severity: QUALITY_WARNING_SEVERITY,
          },
        ]),
    ...checkDuration(mediaInfo, options),
    ...checkStreamDurations(mediaInfo, options),
    ...checkVideoFrameRate(mediaInfo),
  ]

  return {
    audioStreams,
    ...(mediaInfo.duration === undefined ? {} : {duration: mediaInfo.duration}),
    ...countQualityIssues(issues),
    issues,
    probed: true,
    subtitleStreams,
    videoStreams,
  }
}

export function createRenderedMediaProbeFailure(message: string): RenderedMediaQualityResult {
  const issues: QualityIssue[] = [
    {
      code: 'render.output.probe_failed',
      message,
      severity: QUALITY_WARNING_SEVERITY,
    },
  ]

  return {
    audioStreams: 0,
    errors: 0,
    issues,
    probed: false,
    subtitleStreams: 0,
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
        severity: QUALITY_WARNING_SEVERITY,
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
      severity: QUALITY_WARNING_SEVERITY,
    },
  ]
}

function checkStreamDurations(mediaInfo: MediaInfo, options: RenderedMediaQualityOptions): QualityIssue[] {
  if (options.expectedDuration === undefined) {
    return []
  }

  const tolerance = options.timingTolerance ?? 0.2
  const videoDuration = mediaInfo.streams.find((stream) => stream.type === 'video')?.duration
  const audioDuration = mediaInfo.streams.find((stream) => stream.type === 'audio')?.duration
  const issues: QualityIssue[] = []

  if (videoDuration !== undefined && Math.abs(videoDuration - options.expectedDuration) > tolerance) {
    issues.push({
      code: 'render.output.video_duration_mismatch',
      message: `Rendered video stream duration ${videoDuration} differs from expected ${options.expectedDuration}.`,
      severity: QUALITY_WARNING_SEVERITY,
    })
  }

  if (options.expectAudio === true && audioDuration !== undefined && Math.abs(audioDuration - options.expectedDuration) > tolerance) {
    issues.push({
      code: 'render.output.audio_duration_mismatch',
      message: `Rendered audio stream duration ${audioDuration} differs from expected ${options.expectedDuration}.`,
      severity: QUALITY_WARNING_SEVERITY,
    })
  }

  return issues
}

function checkVideoFrameRate(mediaInfo: MediaInfo): QualityIssue[] {
  const lowFpsStream = mediaInfo.streams.find((stream) => stream.type === 'video' && stream.fps !== undefined && stream.fps < 1)

  if (lowFpsStream === undefined || lowFpsStream.fps === undefined) {
    return []
  }

  return [
    {
      code: 'render.output.low_video_fps',
      message: `Rendered video stream frame rate is too low (${round(lowFpsStream.fps)} fps).`,
      severity: QUALITY_WARNING_SEVERITY,
    },
  ]
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
