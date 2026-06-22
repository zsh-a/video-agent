import type {Narration} from '@video-agent/ir'
import type {TTSSegment} from '@video-agent/providers'
import type {FfmpegAudioOptions, FfmpegVoiceoverInput} from '@video-agent/renderer-ffmpeg'
import type {ProjectWorkspace} from '../shared/workspace.js'
import type {FfmpegAudioDiagnostics, MissingVoiceoverDiagnostic, RenderProjectOptions, VoiceoverPlanArtifact, VoiceoverPlanSegment} from './project.js'
import type {VoiceoverAlignment} from './voiceover-plan.js'

import {TtsSegmentsSchema} from '@video-agent/providers'
import {access} from 'node:fs/promises'
import {isAbsolute, resolve} from 'node:path'

import {readNarrationIfAvailable} from './subtitles.js'
import {TTS_SEGMENTS_ARTIFACT_NAME} from '../artifacts/artifact-names.js'
import {MISSING_VOICEOVER_REASON, VOICEOVER_ALIGNMENT_NARRATION_ID, VOICEOVER_ALIGNMENT_SEQUENTIAL, VOICEOVER_STATUS_AVAILABLE, VOICEOVER_STATUS_MISSING} from './voiceover-plan.js'

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
  duration: number
  start: number
}

async function readVoiceoversIfAvailable(workspace: ProjectWorkspace): Promise<VoiceoverPlan> {
  let rawSegments: TTSSegment[]

  try {
    rawSegments = TtsSegmentsSchema.parse(await workspace.store.readJson(TTS_SEGMENTS_ARTIFACT_NAME))
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
    const narrationSegment = narrationById.get(segment.narrationId)

    return {
      index,
      raw: segment,
      timing: cursor.resolve(segment, {
        narrationSegment,
      }),
    }
  })
  const results = await Promise.all(
    plannedSegments.map(async ({index, raw: segment, timing}): Promise<VoiceoverPlanBuildResult> => {
      const {alignment, duration, start} = timing

      const resolvedPath = resolveTtsPath(segment.path, workspace)
      const path = await findExistingPath(resolvedPath)

      if (path === undefined) {
        return {
          segment: {
            alignment,
            duration,
            index,
            narrationId: segment.narrationId,
            path: segment.path,
            resolvedPath,
            start,
            status: VOICEOVER_STATUS_MISSING,
          },
        }
      }

      return {
        segment: {
          alignment,
          duration,
          index,
          narrationId: segment.narrationId,
          path: segment.path,
          resolvedPath,
          start,
          status: VOICEOVER_STATUS_AVAILABLE,
        },
        voiceover: {
          duration,
          path,
          start,
        },
      }
    }),
  )
  const segments = results.map((result) => result.segment)
  const missing = segments
    .filter((segment) => segment.status !== VOICEOVER_STATUS_AVAILABLE)
    .map((segment): MissingVoiceoverDiagnostic => ({
      index: segment.index,
      narrationId: segment.narrationId,
      path: segment.path,
      reason: MISSING_VOICEOVER_REASON,
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

function createAudioWarnings(sourceAudioPath: string | undefined, voiceoverPlan: VoiceoverPlan): string[] {
  return [
    ...(sourceAudioPath === undefined && voiceoverPlan.voiceovers.length === 0 ? ['No usable audio inputs were found; render will be silent unless the source video already contains audio copied by ffmpeg.'] : []),
    ...(voiceoverPlan.missing.length === 0 ? [] : [`${voiceoverPlan.missing.length} TTS voiceover segment(s) were referenced but unavailable.`]),
  ]
}

function createVoiceoverTimingCursor(): {
  resolve: (
    segment: TTSSegment,
    options: {
      narrationSegment: Narration['segments'][number] | undefined
    },
  ) => VoiceoverTiming
} {
  const cursors = new Map<string, number>()

  return {
    resolve(segment, options) {
      const key = `id:${segment.narrationId}`
      const timing = resolveVoiceoverTimingStart(segment, {
        existingCursor: cursors.get(key),
        narrationSegment: options.narrationSegment,
      })

      cursors.set(key, timing.start + segment.duration)

      return {
        ...timing,
        duration: segment.duration,
      }
    },
  }
}

function resolveVoiceoverTimingStart(
  segment: TTSSegment,
  options: {
    existingCursor?: number
    narrationSegment: Narration['segments'][number] | undefined
  },
): Pick<VoiceoverTiming, 'alignment' | 'start'> {
  if (options.existingCursor !== undefined) {
    return {
      alignment: VOICEOVER_ALIGNMENT_SEQUENTIAL,
      start: options.existingCursor,
    }
  }

  if (options.narrationSegment?.start !== undefined) {
    return {
      alignment: VOICEOVER_ALIGNMENT_NARRATION_ID,
      start: options.narrationSegment.start,
    }
  }

  throw new Error(`Voiceover segment "${segment.narrationId}" requires a matching narration segment; no segment-index timing fallback is allowed.`)
}

function resolveTtsPath(path: string, workspace: ProjectWorkspace): string {
  if (isAbsolute(path)) {
    return path
  }

  return resolve(workspace.projectDir, path)
}

async function findExistingPath(path: string): Promise<string | undefined> {
  try {
    await access(path)
    return path
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}
