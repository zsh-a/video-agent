import type {Narration} from '@video-agent/ir'
import type {AudioLoudnessQualityResult, RenderedMediaQualityResult, SubtitleQualityResult, VisualSmokeQualityResult} from '@video-agent/quality'
import type {FfmpegAudioOptions, FfmpegVoiceoverInput} from '@video-agent/renderer-ffmpeg'
import type {HyperframesCliResult} from '@video-agent/renderer-hyperframes'

import {NarrationSchema, StoryboardSchema, TimelineSchema} from '@video-agent/ir'
import {extractVideoFrame, inspectAudioVolume, inspectVideoBlackDetect, probeMedia} from '@video-agent/media'
import {
  addVisualFrameSample,
  checkAudioLoudness,
  checkRenderedMedia,
  checkSrtSubtitles,
  checkVisualSmoke,
  createAudioLoudnessProbeFailure,
  createRenderedMediaProbeFailure,
  createVisualSmokeProbeFailure,
} from '@video-agent/quality'
import {narrationToSrt, renderTimelineWithFfmpeg} from '@video-agent/renderer-ffmpeg'
import {renderHyperframesProject, validateHyperframesProject, writeHyperframesProject} from '@video-agent/renderer-hyperframes'
import {access, readFile, stat, writeFile} from 'node:fs/promises'
import {isAbsolute, resolve} from 'node:path'

import {createProjectWorkspace} from './workspace.js'

export type ProjectRenderer = 'ffmpeg' | 'hyperframes'

export interface RenderProjectOptions {
  audio?: boolean
  audioDucking?: boolean
  duckingAttackMs?: number
  duckingRatio?: number
  duckingReleaseMs?: number
  duckingThreshold?: number
  hyperframesCommand?: string[]
  hyperframesOutput?: string
  hyperframesRender?: boolean
  hyperframesValidate?: boolean
  output?: string
  renderer?: ProjectRenderer
  sourceVolume?: number
  subtitles?: boolean
  voiceoverVolume?: number
  workspaceDir?: string
}

export type RenderProjectResult = FfmpegProjectRenderResult | HyperframesProjectRenderResult

export interface FfmpegProjectRenderResult {
  artifactPath: string
  audioDiagnostics: FfmpegAudioDiagnostics
  audioInputs: number
  audioQuality?: AudioLoudnessQualityResult
  outputPath: string
  outputQuality: RenderedMediaQualityResult
  projectDir: string
  projectId: string
  renderer: 'ffmpeg'
  subtitlePath?: string
  subtitleQuality?: SubtitleQualityResult
  visualQuality?: VisualSmokeQualityResult
  voiceoverPlanPath: string
}

export interface FfmpegAudioDiagnostics {
  availableVoiceovers: number
  missingVoiceovers: MissingVoiceoverDiagnostic[]
  plan: VoiceoverPlanArtifact
  sourceAudioPath?: string
  warnings: string[]
}

export interface VoiceoverPlanArtifact {
  generatedAt: string
  segments: VoiceoverPlanSegment[]
  version: 1
}

export interface VoiceoverPlanSegment {
  alignment: VoiceoverAlignment
  duration?: number
  index: number
  narrationId?: string
  path?: string
  resolvedPath?: string
  start: number
  status: 'available' | 'invalid-path' | 'missing'
}

export type VoiceoverAlignment = 'explicit-start' | 'narration-id' | 'narration-index' | 'sequential'

export interface MissingVoiceoverDiagnostic {
  index: number
  narrationId?: string
  path?: string
  reason: 'invalid-path' | 'missing'
  resolvedPath?: string
}

export interface HyperframesProjectRenderResult {
  artifactPath: string
  entryHtml: string
  outputDir: string
  projectDir: string
  projectId: string
  rendered?: HyperframesCliResult
  renderer: 'hyperframes'
  validation?: HyperframesCliResult
}

export async function renderProject(projectId: string, options: RenderProjectOptions = {}): Promise<RenderProjectResult> {
  const workspace = await createProjectWorkspace({
    projectId,
    workspaceDir: options.workspaceDir,
  })

  return (options.renderer ?? 'ffmpeg') === 'hyperframes' ? renderProjectWithHyperframes(workspace, options) : renderProjectWithFfmpeg(workspace, options)
}

export async function inspectFfmpegAudio(projectId: string, options: RenderProjectOptions = {}): Promise<FfmpegAudioDiagnostics> {
  const workspace = await createProjectWorkspace({
    projectId,
    workspaceDir: options.workspaceDir,
  })
  const audioPlan = options.audio === false ? createDisabledAudioPlan() : await readAudioPlanIfAvailable(workspace, options)

  return audioPlan.diagnostics
}

async function renderProjectWithFfmpeg(workspace: Awaited<ReturnType<typeof createProjectWorkspace>>, options: RenderProjectOptions): Promise<FfmpegProjectRenderResult> {
  const timeline = TimelineSchema.parse(await workspace.store.readJson('timeline.json'))
  const subtitlePath = options.subtitles === false ? undefined : await writeSubtitlesIfAvailable(workspace)
  const subtitleQuality = subtitlePath === undefined ? undefined : await inspectSubtitleFile(subtitlePath, workspace, timeline.duration)
  const audioPlan = options.audio === false ? createDisabledAudioPlan() : await readAudioPlanIfAvailable(workspace, options)
  const voiceoverPlanPath = await workspace.store.writeJson('voiceover-plan.json', audioPlan.diagnostics.plan)
  const outputPath = options.output === undefined ? resolve(workspace.rendersDir, 'final.mp4') : resolve(options.output)
  const result = await renderTimelineWithFfmpeg(timeline, {
    audio: audioPlan.audio,
    outputPath,
    subtitlePath,
  })
  const outputQuality = await inspectRenderedOutput(result.outputPath, {
    expectAudio: result.audioInputs > 0,
    expectedDuration: timeline.duration,
  })
  const audioQuality = outputQuality.audioStreams > 0 ? await inspectRenderedAudio(result.outputPath) : undefined
  const visualQuality = outputQuality.videoStreams > 0 ? await inspectRenderedVisual(result.outputPath, resolve(workspace.rendersDir, 'final-first-frame.jpg'), outputQuality.duration) : undefined
  const artifactPath = await workspace.store.writeJson('render-output.json', {
    audio: audioPlan.audio,
    audioDiagnostics: audioPlan.diagnostics,
    audioInputs: result.audioInputs,
    audioQuality,
    completedAt: new Date().toISOString(),
    outputPath: result.outputPath,
    outputQuality,
    renderer: 'ffmpeg',
    source: result.source,
    subtitlePath,
    subtitleQuality,
    version: 1,
    visualQuality,
    voiceoverPlanPath,
  })

  return {
    artifactPath,
    audioDiagnostics: audioPlan.diagnostics,
    audioInputs: result.audioInputs,
    ...(audioQuality === undefined ? {} : {audioQuality}),
    outputPath: result.outputPath,
    outputQuality,
    projectDir: workspace.projectDir,
    projectId: workspace.projectId,
    renderer: 'ffmpeg',
    ...(subtitlePath === undefined ? {} : {subtitlePath}),
    ...(subtitleQuality === undefined ? {} : {subtitleQuality}),
    ...(visualQuality === undefined ? {} : {visualQuality}),
    voiceoverPlanPath,
  }
}

async function inspectRenderedOutput(outputPath: string, options: {expectAudio: boolean; expectedDuration: number}): Promise<RenderedMediaQualityResult> {
  try {
    return checkRenderedMedia(await probeMedia(outputPath), options)
  } catch (error) {
    return createRenderedMediaProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

async function inspectRenderedAudio(outputPath: string): Promise<AudioLoudnessQualityResult> {
  try {
    return checkAudioLoudness(await inspectAudioVolume(outputPath))
  } catch (error) {
    return createAudioLoudnessProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

async function inspectRenderedVisual(outputPath: string, frameSamplePath: string, duration?: number): Promise<VisualSmokeQualityResult> {
  const smokeQuality = await inspectRenderedBlackFrames(outputPath, duration)

  return addVisualFrameSample(smokeQuality, await captureVisualFrameSample(outputPath, frameSamplePath))
}

async function inspectRenderedBlackFrames(outputPath: string, duration?: number): Promise<VisualSmokeQualityResult> {
  try {
    return checkVisualSmoke(await inspectVideoBlackDetect(outputPath, duration))
  } catch (error) {
    return createVisualSmokeProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

async function captureVisualFrameSample(outputPath: string, frameSamplePath: string): Promise<NonNullable<VisualSmokeQualityResult['frameSample']>> {
  const timestamp = 0

  try {
    await extractVideoFrame(outputPath, frameSamplePath, timestamp)
    const info = await stat(frameSamplePath)

    return {
      capturedAt: new Date().toISOString(),
      ok: true,
      path: frameSamplePath,
      size: info.size,
      timestamp,
    }
  } catch (error) {
    return {
      capturedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      path: frameSamplePath,
      timestamp,
    }
  }
}

async function renderProjectWithHyperframes(workspace: Awaited<ReturnType<typeof createProjectWorkspace>>, options: RenderProjectOptions): Promise<HyperframesProjectRenderResult> {
  const timeline = TimelineSchema.parse(await workspace.store.readJson('timeline.json'))
  const storyboard = StoryboardSchema.parse(await workspace.store.readJson('storyboard.json'))
  const narration = await readNarrationIfAvailable(workspace)
  const outputDir = options.output === undefined ? resolve(workspace.rendersDir, 'hyperframes') : resolve(options.output)
  const result = await writeHyperframesProject({
    narration,
    outputDir,
    storyboard,
    timeline,
  })
  const validation = options.hyperframesValidate === true ? await validateHyperframesProject({command: options.hyperframesCommand, projectDir: result.outputDir}) : undefined
  const rendered =
    options.hyperframesRender === true
      ? await renderHyperframesProject({
          command: options.hyperframesCommand,
          outputPath: options.hyperframesOutput === undefined ? resolve(result.outputDir, 'output.mp4') : resolve(options.hyperframesOutput),
          projectDir: result.outputDir,
        })
      : undefined
  const artifactPath = await workspace.store.writeJson('render-output.json', {
    completedAt: new Date().toISOString(),
    entryHtml: result.entryHtml,
    outputDir: result.outputDir,
    planPath: result.planPath,
    rendered,
    renderer: 'hyperframes',
    validation,
    version: 1,
  })

  return {
    artifactPath,
    entryHtml: result.entryHtml,
    outputDir: result.outputDir,
    projectDir: workspace.projectDir,
    projectId: workspace.projectId,
    ...(rendered === undefined ? {} : {rendered}),
    renderer: 'hyperframes',
    ...(validation === undefined ? {} : {validation}),
  }
}

async function writeSubtitlesIfAvailable(workspace: Awaited<ReturnType<typeof createProjectWorkspace>>): Promise<string | undefined> {
  const narration = await readNarrationIfAvailable(workspace)

  if (narration === undefined) {
    return undefined
  }

  const subtitlePath = resolve(workspace.rendersDir, 'subtitles.srt')

  await writeFile(subtitlePath, narrationToSrt(narration))

  return subtitlePath
}

async function inspectSubtitleFile(subtitlePath: string, workspace: Awaited<ReturnType<typeof createProjectWorkspace>>, maxEnd: number): Promise<SubtitleQualityResult> {
  const narration = await readNarrationIfAvailable(workspace)

  return checkSrtSubtitles(await readFile(subtitlePath, 'utf8'), {
    expectedCues: narration?.segments.length,
    maxEnd,
  })
}

async function readNarrationIfAvailable(workspace: Awaited<ReturnType<typeof createProjectWorkspace>>): Promise<Narration | undefined> {
  try {
    return NarrationSchema.parse(await workspace.store.readJson('narration.json'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}

interface FfmpegAudioPlan {
  audio?: FfmpegAudioOptions
  diagnostics: FfmpegAudioDiagnostics
}

function createDisabledAudioPlan(): FfmpegAudioPlan {
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

async function readAudioPlanIfAvailable(workspace: Awaited<ReturnType<typeof createProjectWorkspace>>, options: RenderProjectOptions): Promise<FfmpegAudioPlan> {
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

async function readVoiceoversIfAvailable(workspace: Awaited<ReturnType<typeof createProjectWorkspace>>): Promise<VoiceoverPlan> {
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

function resolveTtsPath(path: string, workspace: Awaited<ReturnType<typeof createProjectWorkspace>>): string {
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
