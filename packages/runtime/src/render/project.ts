import type {AudioLoudnessQualityResult, RenderedMediaQualityResult, SubtitleQualityResult, VisualSmokeQualityResult} from '@video-agent/quality'

import {TimelineSchema} from '@video-agent/ir'
import {renderTimelineWithFfmpeg} from '@video-agent/renderer-ffmpeg'
import {resolve} from 'node:path'

import {createDisabledAudioPlan, readAudioPlanIfAvailable} from './audio-plan.js'
import {inspectRenderedAudio, inspectRenderedOutput, inspectRenderedVisual} from './quality.js'
import {inspectSubtitleFile, writeSubtitlesIfAvailable} from './subtitles.js'
import {createProjectWorkspace} from '../shared/workspace.js'

export type ProjectRenderer = 'ffmpeg'

export interface RenderProjectOptions {
  audio?: boolean
  audioDucking?: boolean
  duckingAttackMs?: number
  duckingRatio?: number
  duckingReleaseMs?: number
  duckingThreshold?: number
  output?: string
  sourceVolume?: number
  subtitles?: boolean
  voiceoverVolume?: number
  workspaceDir?: string
}

export type RenderProjectResult = FfmpegProjectRenderResult

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

export async function renderProject(projectId: string, options: RenderProjectOptions = {}): Promise<RenderProjectResult> {
  const workspace = await createProjectWorkspace({
    projectId,
    workspaceDir: options.workspaceDir,
  })

  return renderProjectWithFfmpeg(workspace, options)
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
  const visualQuality = outputQuality.videoStreams > 0 ? await inspectRenderedVisual(result.outputPath, workspace.rendersDir, outputQuality.duration) : undefined
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
