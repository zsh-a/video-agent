import type {FilmAudioMix, FilmAudioMixVoiceover, OutputNarration, OutputNarrationSegment} from '@video-agent/ir'
import type {TTSSegment} from '@video-agent/providers'

import {runFfmpeg} from '@video-agent/media'
import {mkdir, rename} from 'node:fs/promises'
import {resolve} from 'node:path'

import {assertFileExists, resolveProjectPath, roundSeconds} from '../shared/utils.js'
import {unlinkIfExists} from './utils.js'

export const FILM_AUDIO_LOUDNESS_NORMALIZATION = {
  loudnessRangeLufs: 11,
  targetIntegratedLufs: -18,
  truePeakDb: -1.5,
}

const FILM_TTS_DURATION_TOLERANCE_SECONDS = 0.05

export async function alignFilmTtsSegmentsToOutputNarration(projectDir: string, outputNarration: OutputNarration, ttsSegments: TTSSegment[]): Promise<TTSSegment[]> {
  const narrationById = new Map(outputNarration.segments.map((segment) => [segment.id, segment]))

  return Promise.all(ttsSegments.map(async (ttsSegment, index) => {
    const narrationSegment = narrationById.get(ttsSegment.narrationId)

    if (narrationSegment === undefined) {
      throw new Error(`TTS segment ${index + 1} references unknown narrationId "${ttsSegment.narrationId}".`)
    }

    const targetDuration = requireOutputNarrationSegmentDuration(narrationSegment, 'TTS alignment')
    const ttsDuration = requireTtsSegmentDuration(ttsSegment, 'TTS alignment')

    if (ttsDuration <= targetDuration + FILM_TTS_DURATION_TOLERANCE_SECONDS) {
      return ttsSegment
    }

    const path = resolveProjectPath(projectDir, ttsSegment.path)

    await assertFileExists(path)
    await conformAudioDuration(path, ttsDuration, targetDuration)

    return {
      ...ttsSegment,
      duration: roundSeconds(targetDuration),
    }
  }))
}

export async function createAudioMixVoiceovers(projectDir: string, outputNarration: OutputNarration, ttsSegments: TTSSegment[]): Promise<FilmAudioMixVoiceover[]> {
  const narrationById = new Map(outputNarration.segments.map((segment) => [segment.id, segment]))
  const voiceovers = ttsSegments.map((ttsSegment, index) => {
    const narrationSegment = narrationById.get(ttsSegment.narrationId)

    if (narrationSegment === undefined) {
      throw new Error(`TTS segment ${index + 1} references unknown narrationId "${ttsSegment.narrationId}".`)
    }

    requireOutputNarrationSegmentDuration(narrationSegment, 'audio mixing')
    const start = roundSeconds(narrationSegment.start)
    const duration = roundSeconds(requireTtsSegmentDuration(ttsSegment, 'audio mixing'))
    const resolvedPath = resolveProjectPath(projectDir, ttsSegment.path)

    return {
      delayMs: Math.round(start * 1000),
      duration,
      narrationId: ttsSegment.narrationId,
      path: ttsSegment.path,
      resolvedPath,
      start,
    }
  })

  await Promise.all(voiceovers.map((voiceover) => assertFileExists(voiceover.resolvedPath)))

  return voiceovers
}

function requireTtsSegmentDuration(ttsSegment: TTSSegment, stage: string): number {
  if (!Number.isFinite(ttsSegment.duration) || ttsSegment.duration <= 0) {
    throw new Error(`TTS segment "${ttsSegment.narrationId}" must include a positive duration for ${stage}; no narration-duration fallback is allowed.`)
  }

  return ttsSegment.duration
}

function requireOutputNarrationSegmentDuration(segment: OutputNarrationSegment, stage: string): number {
  if (!Number.isFinite(segment.start) || segment.start < 0) {
    throw new Error(`Output narration segment "${segment.id}" must include a finite non-negative start for ${stage}; no audio timing clamp fallback is allowed. Received: ${String(segment.start)}`)
  }

  if (!Number.isFinite(segment.end) || segment.end <= segment.start) {
    throw new Error(`Output narration segment "${segment.id}" must include an end greater than start for ${stage}; no audio timing clamp fallback is allowed. Received start=${String(segment.start)} end=${String(segment.end)}`)
  }

  return roundSeconds(segment.end - segment.start)
}

export function getAudioMixMode(hasSourceAudio: boolean, hasVoiceover: boolean): FilmAudioMix['mode'] {
  if (hasSourceAudio && hasVoiceover) {
    return 'source-ducked'
  }

  if (hasSourceAudio) {
    return 'source-only'
  }

  if (hasVoiceover) {
    return 'voiceover-only'
  }

  return 'silence'
}

export async function renderAudioMix(outputPath: string, duration: number, sourceAudioPath: string | undefined, voiceovers: FilmAudioMixVoiceover[]): Promise<void> {
  const mixDuration = requirePositiveFiniteDuration(duration, 'Film audio mix duration')
  const validVoiceovers = voiceovers.map(requireAudioMixVoiceover)

  await mkdir(resolve(outputPath, '..'), {recursive: true})

  if (sourceAudioPath === undefined && validVoiceovers.length === 0) {
    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-t',
      String(mixDuration),
      '-c:a',
      'pcm_s16le',
      outputPath,
    ])
    return
  }

  const inputArgs = [
    ...(sourceAudioPath === undefined ? [] : ['-i', sourceAudioPath]),
    ...validVoiceovers.flatMap((voiceover) => ['-i', voiceover.resolvedPath]),
  ]
  const sourceFilter = sourceAudioPath === undefined
    ? []
    : [buildSourceAudioFilter(mixDuration, validVoiceovers)]
  const voiceoverInputOffset = sourceAudioPath === undefined ? 0 : 1
  const filters = validVoiceovers.map((voiceover, index) => {
    const inputIndex = index + voiceoverInputOffset

    return `[${inputIndex}:a]atrim=duration=${voiceover.duration},asetpts=PTS-STARTPTS,adelay=${voiceover.delayMs}:all=1,volume=1[voice${index}]`
  })
  const filter = buildAudioMixFilter({
    duration: mixDuration,
    hasSourceAudio: sourceAudioPath !== undefined,
    sourceFilters: sourceFilter,
    voiceoverCount: validVoiceovers.length,
    voiceoverFilters: filters,
  })

  await runFfmpeg([
    '-y',
    ...inputArgs,
    '-filter_complex',
    filter,
    '-map',
    '[mix]',
    '-c:a',
    'pcm_s16le',
    outputPath,
  ])
}

async function conformAudioDuration(path: string, sourceDuration: number, targetDuration: number): Promise<void> {
  const tempOutputPath = `${path}.tmp-${process.pid}-${Date.now()}.wav`
  const tempo = sourceDuration / targetDuration
  const filter = [
    buildAtempoFilterChain(tempo),
    'apad',
    `atrim=duration=${roundSeconds(targetDuration)}`,
    'asetpts=PTS-STARTPTS',
  ].join(',')

  try {
    await runFfmpeg([
      '-y',
      '-i',
      path,
      '-filter:a',
      filter,
      '-ar',
      '48000',
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
      tempOutputPath,
    ])
    await rename(tempOutputPath, path)
  } catch (error) {
    await unlinkIfExists(tempOutputPath)
    throw error
  }
}

function buildAtempoFilterChain(tempo: number): string {
  if (!Number.isFinite(tempo) || tempo <= 0) {
    throw new Error(`Film TTS audio duration conform requires a positive tempo; no atempo noop fallback is allowed. Received: ${String(tempo)}`)
  }

  const tempos: number[] = []
  let remaining = tempo

  while (remaining > 2) {
    tempos.push(2)
    remaining /= 2
  }

  while (remaining < 0.5) {
    tempos.push(0.5)
    remaining /= 0.5
  }

  tempos.push(remaining)

  return tempos.map((value) => `atempo=${formatFilterNumber(value)}`).join(',')
}

function formatFilterNumber(value: number): string {
  return String(Math.round(value * 1_000_000) / 1_000_000)
}

function buildSourceAudioFilter(duration: number, voiceovers: FilmAudioMixVoiceover[]): string {
  if (voiceovers.length === 0) {
    return `[0:a:0]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=0.35[source]`
  }

  const condition = voiceovers
    .map((voiceover) => {
      const start = roundSeconds(voiceover.start)
      const end = roundSeconds(voiceover.start + voiceover.duration)

      return `between(t,${start},${end})`
    })
    .join('+')
  const volumeExpression = escapeFfmpegFilterExpression(`if(gt(${condition},0),0,0.25)`)

  return `[0:a:0]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${volumeExpression}:eval=frame[source]`
}

function escapeFfmpegFilterExpression(value: string): string {
  return value.replaceAll(',', String.raw`\,`)
}

function buildAudioMixFilter(options: {
  duration: number
  hasSourceAudio: boolean
  sourceFilters: string[]
  voiceoverCount: number
  voiceoverFilters: string[]
}): string {
  const allFilters = [...options.sourceFilters, ...options.voiceoverFilters]

  if (options.hasSourceAudio && options.voiceoverCount === 0) {
    return normalizeFilmAudioMix(`${allFilters.join(';')};[source]apad,atrim=duration=${options.duration},aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[premix]`)
  }

  const voiceLabels = Array.from({length: options.voiceoverCount}, (_, index) => `[voice${index}]`)

  if (!options.hasSourceAudio) {
    return normalizeFilmAudioMix(`${allFilters.join(';')};${voiceLabels.join('')}amix=inputs=${options.voiceoverCount}:duration=longest:dropout_transition=0,apad,atrim=duration=${options.duration},aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[premix]`)
  }

  const voiceBus = options.voiceoverCount === 1
    ? `${voiceLabels[0]}anull[voicebus]`
    : `${voiceLabels.join('')}amix=inputs=${options.voiceoverCount}:duration=longest:dropout_transition=0[voicebus]`

  return normalizeFilmAudioMix([
    ...allFilters,
    voiceBus,
    `[voicebus]apad,atrim=duration=${options.duration},asplit=2[duckkey][voicemix]`,
    '[source][duckkey]sidechaincompress=threshold=0.03:ratio=8:attack=300:release=450[ducked]',
    `[ducked][voicemix]amix=inputs=2:duration=longest:dropout_transition=0,apad,atrim=duration=${options.duration},aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[premix]`,
  ].join(';'))
}

function requireAudioMixVoiceover(voiceover: FilmAudioMixVoiceover): FilmAudioMixVoiceover {
  if (!Number.isFinite(voiceover.start) || voiceover.start < 0) {
    throw new Error(`Film audio mix voiceover "${voiceover.narrationId}" must include a finite non-negative start; no audio timing clamp fallback is allowed. Received: ${String(voiceover.start)}`)
  }

  requirePositiveFiniteDuration(voiceover.duration, `Film audio mix voiceover "${voiceover.narrationId}" duration`)

  if (!Number.isInteger(voiceover.delayMs) || voiceover.delayMs < 0) {
    throw new Error(`Film audio mix voiceover "${voiceover.narrationId}" delayMs must be a non-negative integer; no audio timing clamp fallback is allowed. Received: ${String(voiceover.delayMs)}`)
  }

  return voiceover
}

function requirePositiveFiniteDuration(duration: number, label: string): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`${label} must be a positive finite duration; no synthetic minimum audio duration fallback is allowed. Received: ${String(duration)}`)
  }

  return duration
}

function normalizeFilmAudioMix(filter: string): string {
  return `${filter};[premix]loudnorm=I=${FILM_AUDIO_LOUDNESS_NORMALIZATION.targetIntegratedLufs}:TP=${FILM_AUDIO_LOUDNESS_NORMALIZATION.truePeakDb}:LRA=${FILM_AUDIO_LOUDNESS_NORMALIZATION.loudnessRangeLufs},aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[mix]`
}
