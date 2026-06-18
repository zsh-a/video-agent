import type {Timeline, TimelineItem} from '@video-agent/ir'

import {runFfmpeg} from '@video-agent/media'

export interface FfmpegRenderOptions {
  audio?: FfmpegAudioOptions
  outputPath: string
  overwrite?: boolean
  subtitlePath?: string
}

export interface FfmpegAudioOptions {
  ducking?: FfmpegDuckingOptions
  sourceAudioPath?: string
  sourceVolume?: number
  voiceovers?: FfmpegVoiceoverInput[]
  voiceoverVolume?: number
}

export interface FfmpegDuckingOptions {
  attackMs?: number
  enabled?: boolean
  ratio?: number
  releaseMs?: number
  threshold?: number
}

export interface FfmpegVoiceoverInput {
  duration?: number
  path: string
  start: number
}

export interface FfmpegRenderResult {
  audioInputs: number
  outputPath: string
  source: string
}

export async function renderTimelineWithFfmpeg(timeline: Timeline, options: FfmpegRenderOptions): Promise<FfmpegRenderResult> {
  const video = findPrimaryVideo(timeline)
  const args = buildFfmpegRenderArgs(timeline, options)

  await runFfmpeg(args)

  return {
    audioInputs: countAudioInputs(options.audio),
    outputPath: options.outputPath,
    source: video.source,
  }
}

export function buildFfmpegRenderArgs(timeline: Timeline, options: FfmpegRenderOptions): string[] {
  const video = findPrimaryVideo(timeline)
  const sourceRange = video.sourceRange ?? [0, video.duration]
  const audioInputs = buildAudioInputs(options.audio)
  const audioFilter = buildAudioFilter(audioInputs, video.duration, options.audio)
  const args: string[] = [
    ...(options.overwrite === false ? [] : ['-y']),
    '-ss',
    String(sourceRange[0]),
    '-i',
    video.source,
    ...audioInputs.flatMap((input) => ['-i', input.path]),
    '-t',
    String(video.duration),
  ]

  if (options.subtitlePath !== undefined) {
    args.push('-vf', `subtitles=${escapeSubtitleFilterPath(options.subtitlePath)}`)
  }

  if (audioFilter === undefined) {
    args.push(...(options.subtitlePath === undefined ? ['-c', 'copy'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy']))
  } else {
    args.push(
      '-filter_complex',
      audioFilter.filter,
      '-map',
      '0:v:0',
      '-map',
      audioFilter.outputLabel,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
    )
  }

  args.push(options.outputPath)

  return args
}

interface AudioInput {
  duration?: number
  kind: 'source' | 'voiceover'
  path: string
  start: number
}

interface AudioFilter {
  filter: string
  outputLabel: string
}

function buildAudioInputs(options: FfmpegAudioOptions | undefined): AudioInput[] {
  if (options === undefined) {
    return []
  }

  return [
    ...(options.sourceAudioPath === undefined ? [] : [{kind: 'source' as const, path: options.sourceAudioPath, start: 0}]),
    ...(options.voiceovers ?? []).map((voiceover) => ({
      ...(voiceover.duration === undefined ? {} : {duration: voiceover.duration}),
      kind: 'voiceover' as const,
      path: voiceover.path,
      start: voiceover.start,
    })),
  ]
}

function buildAudioFilter(inputs: AudioInput[], duration: number, options: FfmpegAudioOptions | undefined): AudioFilter | undefined {
  if (inputs.length === 0) {
    return undefined
  }

  const preparedLabels = inputs.map((input, index) => {
    const inputIndex = index + 1
    const label = input.kind === 'source' ? `source${index}` : `voice${index}`
    const volume = input.kind === 'source' ? (options?.sourceVolume ?? 0.35) : (options?.voiceoverVolume ?? 1)
    const delay = input.start <= 0 ? [] : [`adelay=${Math.round(input.start * 1000)}:all=1`]
    const trim = input.duration === undefined ? [] : [`atrim=duration=${input.duration}`]
    const filters = [...trim, ...delay, `volume=${volume}`].join(',')

    return {
      filter: `[${inputIndex}:a]${filters}[${label}]`,
      kind: input.kind,
      label,
    }
  })

  const outputLabel = '[aout]'
  const source = preparedLabels.find((input) => input.kind === 'source')
  const voiceovers = preparedLabels.filter((input) => input.kind === 'voiceover')

  if (source !== undefined && voiceovers.length > 0 && options?.ducking?.enabled === true) {
    return buildDuckingAudioFilter({
      duration,
      options: options.ducking,
      outputLabel,
      preparedLabels,
      source,
      voiceovers,
    })
  }

  if (preparedLabels.length === 1) {
    return {
      filter: `${preparedLabels[0].filter};[${preparedLabels[0].label}]apad,atrim=duration=${duration},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo${outputLabel}`,
      outputLabel,
    }
  }

  const mixInputs = preparedLabels.map((input) => `[${input.label}]`).join('')

  return {
    filter: `${preparedLabels.map((input) => input.filter).join(';')};${mixInputs}amix=inputs=${preparedLabels.length}:duration=longest:dropout_transition=0,apad,atrim=duration=${duration},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo${outputLabel}`,
    outputLabel,
  }
}

interface PreparedAudioInput {
  filter: string
  kind: AudioInput['kind']
  label: string
}

interface DuckingAudioFilterOptions {
  duration: number
  options: FfmpegDuckingOptions
  outputLabel: string
  preparedLabels: PreparedAudioInput[]
  source: PreparedAudioInput
  voiceovers: PreparedAudioInput[]
}

function buildDuckingAudioFilter(options: DuckingAudioFilterOptions): AudioFilter {
  const voiceBus = '[voicebus]'
  const voiceMix =
    options.voiceovers.length === 1
      ? `[${options.voiceovers[0].label}]anull${voiceBus}`
      : `${options.voiceovers.map((input) => `[${input.label}]`).join('')}amix=inputs=${options.voiceovers.length}:duration=longest:dropout_transition=0${voiceBus}`
  const ducking = [
    `threshold=${options.options.threshold ?? 0.03}`,
    `ratio=${options.options.ratio ?? 8}`,
    `attack=${options.options.attackMs ?? 5}`,
    `release=${options.options.releaseMs ?? 250}`,
  ].join(':')
  const filters = [
    ...options.preparedLabels.map((input) => input.filter),
    voiceMix,
    `${voiceBus}apad,atrim=duration=${options.duration},asplit=2[duckkey][voicemix]`,
    `[${options.source.label}][duckkey]sidechaincompress=${ducking}[ducked]`,
    `[ducked][voicemix]amix=inputs=2:duration=longest:dropout_transition=0,apad,atrim=duration=${options.duration},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo${options.outputLabel}`,
  ]

  return {
    filter: filters.join(';'),
    outputLabel: options.outputLabel,
  }
}

function countAudioInputs(options: FfmpegAudioOptions | undefined): number {
  return buildAudioInputs(options).length
}

function escapeSubtitleFilterPath(path: string): string {
  return path.replaceAll('\\', String.raw`\\`).replaceAll(':', String.raw`\:`).replaceAll("'", String.raw`\'`)
}

function findPrimaryVideo(timeline: Timeline): TimelineItem & {source: string} {
  const video = timeline.items.find((item): item is TimelineItem & {source: string} => item.track === 'video' && item.source !== undefined)

  if (video === undefined) {
    throw new Error('Timeline does not contain a video item with a source.')
  }

  return video
}
