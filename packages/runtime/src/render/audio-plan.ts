import type {Narration} from '@video-agent/ir'
import type {FfmpegAudioOptions, FfmpegVoiceoverInput} from '@video-agent/renderer-ffmpeg'
import type {ProjectWorkspace} from '../shared/workspace.js'
import type {FfmpegAudioDiagnostics, MissingVoiceoverDiagnostic, RenderProjectOptions, VoiceoverAlignment, VoiceoverPlanArtifact, VoiceoverPlanSegment} from './project.js'

import {isAbsolute, resolve} from 'node:path'

import {bunFile} from '../shared/bun-runtime.js'
import {readNarrationIfAvailable} from './subtitles.js'

export interface FfmpegAudioPlan {
  audio?: FfmpegAudioOptions
  diagnostics: FfmpegAudioDiagnostics
}

export function createDisabledAudioPlan(): FfmpegAudioPlan {
  return {
    diagnostics: {
      availableVoiceovers: 0,
      missingVoiceovers: [],
      plan: {
        generatedAt: new Date().toISOString(),
        segments: [],
        version: 1,
      },
      warnings: ['Audio mixing disabled by render options.'],
    },
  }
}

export async function readAudioPlanIfAvailable(workspace: ProjectWorkspace, options: RenderProjectOptions): Promise<FfmpegAudioPlan> {
  const [sourceAudioPath, voiceoverPlan] = await Promise.all([findExistingPath(resolve(workspace.audioDir, 'source.wav')), readVoiceoversIfAvailable(workspace)])
  const diagnostics: FfmpegAudioDiagnostics = {
    availableVoiceovers: voiceoverPlan.voiceovers.length,
    missingVoiceovers: voiceoverPlan.missing,
    plan: voiceoverPlan.artifact,
    ...(sourceAudioPath === undefined ? {} : {sourceAudioPath}),
    warnings: createAudioWarnings(sourceAudioPath, voiceoverPlan),
  }

  if (sourceAudioPath === undefined && voiceoverPlan.voiceovers.length === 0) {
    return {diagnostics}
  }

  return {
    audio: {
      ducking: {
        ...(options.duckingAttackMs === undefined ? {} : {attackMs: options.duckingAttackMs}),
        enabled: options.audioDucking ?? false,
        ...(options.duckingRatio === undefined ? {} : {ratio: options.duckingRatio}),
        ...(options.duckingReleaseMs === undefined ? {} : {releaseMs: options.duckingReleaseMs}),
        ...(options.duckingThreshold === undefined ? {} : {threshold: options.duckingThreshold}),
      },
      ...(sourceAudioPath === undefined ? {} : {sourceAudioPath}),
      ...(options.sourceVolume === undefined ? {} : {sourceVolume: options.sourceVolume}),
      voiceovers: voiceoverPlan.voiceovers,
      ...(options.voiceoverVolume === undefined ? {} : {voiceoverVolume: options.voiceoverVolume}),
    },
    diagnostics,
  }
}

interface RawTtsSegment {
  duration?: unknown
  narrationId?: unknown
  path?: unknown
  start?: unknown
}

interface VoiceoverPlan {
  artifact: VoiceoverPlanArtifact
  missing: MissingVoiceoverDiagnostic[]
  voiceovers: NonNullable<FfmpegAudioOptions['voiceovers']>
}

interface VoiceoverPlanBuildResult {
  segment: VoiceoverPlanSegment
  voiceover?: FfmpegVoiceoverInput
}

interface VoiceoverTiming {
  alignment: VoiceoverAlignment
  duration?: number
  start: number
}

async function readVoiceoversIfAvailable(workspace: ProjectWorkspace): Promise<VoiceoverPlan> {
  let rawSegments: RawTtsSegment[]

  try {
    rawSegments = (await workspace.store.readJson('tts-segments.json')) as RawTtsSegment[]
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {
        artifact: {
          generatedAt: new Date().toISOString(),
          segments: [],
          version: 1,
        },
        missing: [],
        voiceovers: [],
      }
    }

    throw error
  }

  const narration = await readNarrationIfAvailable(workspace)
  const narrationById = new Map(narration?.segments.map((segment) => [segment.id, segment]) ?? [])
  const cursor = createVoiceoverTimingCursor()
  const plannedSegments = rawSegments.map((segment, index) => {
    const narrationSegment = typeof segment.narrationId === 'string' ? narrationById.get(segment.narrationId) : undefined
    const indexedNarrationSegment = narrationSegment ?? narration?.segments[index]

    return {
      index,
      narrationSegment: indexedNarrationSegment,
      raw: segment,
      timing: cursor.resolve(segment, {
        fallbackIndex: index,
        indexedNarrationSegment,
        narrationSegment,
      }),
    }
  })
  const results = await Promise.all(
    plannedSegments.map(async ({index, raw: segment, timing}): Promise<VoiceoverPlanBuildResult> => {
      const {alignment, duration, start} = timing

      if (typeof segment.path !== 'string') {
        return {
          segment: {
            alignment,
            ...(duration === undefined ? {} : {duration}),
            index,
            ...(typeof segment.narrationId === 'string' ? {narrationId: segment.narrationId} : {}),
            start,
            status: 'invalid-path' as const,
          },
        }
      }

      const resolvedPath = resolveTtsPath(segment.path, workspace)
      const path = await findExistingPath(resolvedPath)

      if (path === undefined) {
        return {
          segment: {
            alignment,
            ...(duration === undefined ? {} : {duration}),
            index,
            ...(typeof segment.narrationId === 'string' ? {narrationId: segment.narrationId} : {}),
            path: segment.path,
            resolvedPath,
            start,
            status: 'missing' as const,
          },
        }
      }

      return {
        segment: {
          alignment,
          ...(duration === undefined ? {} : {duration}),
          index,
          ...(typeof segment.narrationId === 'string' ? {narrationId: segment.narrationId} : {}),
          path: segment.path,
          resolvedPath,
          start,
          status: 'available' as const,
        },
        voiceover: {
          ...(duration === undefined ? {} : {duration}),
          path,
          start,
        },
      }
    }),
  )
  const segments = results.map((result) => result.segment)
  const missing = segments
    .filter((segment) => segment.status !== 'available')
    .map((segment): MissingVoiceoverDiagnostic => ({
      index: segment.index,
      ...(segment.narrationId === undefined ? {} : {narrationId: segment.narrationId}),
      ...(segment.path === undefined ? {} : {path: segment.path}),
      reason: segment.status === 'missing' ? 'missing' : 'invalid-path',
      ...(segment.resolvedPath === undefined ? {} : {resolvedPath: segment.resolvedPath}),
    }))

  return {
    artifact: {
      generatedAt: new Date().toISOString(),
      segments,
      version: 1,
    },
    missing,
    voiceovers: results.flatMap((result) => (result.voiceover === undefined ? [] : [result.voiceover])),
  }
}

function resolveVoiceoverDurationValue(segment: RawTtsSegment, narrationSegment: Narration['segments'][number] | undefined): number | undefined {
  return isPositiveFiniteNumber(segment.duration) ? segment.duration : narrationSegment?.duration
}

function createAudioWarnings(sourceAudioPath: string | undefined, voiceoverPlan: VoiceoverPlan): string[] {
  return [
    ...(sourceAudioPath === undefined && voiceoverPlan.voiceovers.length === 0 ? ['No usable audio inputs were found; render will be silent unless the source video already contains audio copied by ffmpeg.'] : []),
    ...(voiceoverPlan.missing.length === 0 ? [] : [`${voiceoverPlan.missing.length} TTS voiceover segment(s) were referenced but unavailable.`]),
  ]
}

function createVoiceoverTimingCursor(): {
  resolve: (
    segment: RawTtsSegment,
    options: {
      fallbackIndex: number
      indexedNarrationSegment: Narration['segments'][number] | undefined
      narrationSegment: Narration['segments'][number] | undefined
    },
  ) => VoiceoverTiming
} {
  const cursors = new Map<string, number>()
  let sequentialCursor = 0

  return {
    resolve(segment, options) {
      const duration = resolveVoiceoverDurationValue(segment, options.narrationSegment ?? options.indexedNarrationSegment)
      const key = typeof segment.narrationId === 'string' ? `id:${segment.narrationId}` : 'sequential'
      const hasExistingCursor = cursors.has(key)
      const timing = resolveVoiceoverTimingStart(segment, {
        existingCursor: cursors.get(key),
        fallbackIndex: options.fallbackIndex,
        hasExistingCursor,
        indexedNarrationSegment: options.indexedNarrationSegment,
        narrationSegment: options.narrationSegment,
        sequentialCursor,
      })
      const nextCursor = timing.start + (duration ?? 0)

      cursors.set(key, nextCursor)

      if (key === 'sequential') {
        sequentialCursor = nextCursor
      }

      return {
        ...timing,
        ...(duration === undefined ? {} : {duration}),
      }
    },
  }
}

function resolveVoiceoverTimingStart(
  segment: RawTtsSegment,
  options: {
    existingCursor?: number
    fallbackIndex: number
    hasExistingCursor: boolean
    indexedNarrationSegment: Narration['segments'][number] | undefined
    narrationSegment: Narration['segments'][number] | undefined
    sequentialCursor: number
  },
): Pick<VoiceoverTiming, 'alignment' | 'start'> {
  if (isNonnegativeFiniteNumber(segment.start)) {
    return {
      alignment: 'explicit-start',
      start: segment.start,
    }
  }

  if (options.hasExistingCursor && options.existingCursor !== undefined) {
    return {
      alignment: 'sequential',
      start: options.existingCursor,
    }
  }

  if (options.narrationSegment?.start !== undefined) {
    return {
      alignment: 'narration-id',
      start: options.narrationSegment.start,
    }
  }

  if (options.indexedNarrationSegment?.start !== undefined) {
    return {
      alignment: 'narration-index',
      start: options.indexedNarrationSegment.start,
    }
  }

  return {
    alignment: 'sequential',
    start: options.sequentialCursor === 0 ? options.fallbackIndex : options.sequentialCursor,
  }
}

function isNonnegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isNonnegativeFiniteNumber(value) && value > 0
}

function resolveTtsPath(path: string, workspace: ProjectWorkspace): string {
  if (isAbsolute(path)) {
    return path
  }

  return resolve(workspace.projectDir, path)
}

async function findExistingPath(path: string): Promise<string | undefined> {
  return await bunFile(path).exists() ? path : undefined
}
