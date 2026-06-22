import type {FilmAudioMix, FilmAudioMixVoiceover, FilmSubtitleOutput, OutputNarration, OutputTimelineMap} from '@video-agent/ir'
import type {TTSSegment} from '@video-agent/providers'
import type {QualityIssue} from '@video-agent/quality'
import type {ProjectWorkspace} from '@video-agent/runtime'

import {checkNarrationTiming, checkSrtSubtitles, checkTtsCoverage, countQualityIssues} from '@video-agent/quality'
import {narrationToSrt, narrationToSrtCues} from '@video-agent/renderer-ffmpeg'
import {FFMPEG_RENDER_OUTPUT_RENDERER, RENDER_OUTPUT_ARTIFACT_NAME, SUBTITLES_ARTIFACT_NAME} from '@video-agent/runtime'
import {readFile, writeFile} from 'node:fs/promises'

import {FILM_AUDIO_LOUDNESS_NORMALIZATION, checkFilmTtsDurationBounds, collectFilmRenderIssues, getAudioMixMode, inspectRenderedAudio, inspectRenderedOutput, withSubtitleBurnInWarning, type FilmRenderOutputArtifact} from '../render/index.js'
import {toProjectReference} from '../shared/utils.js'

export interface FilmQualityReport {
  checkedAt: string
  issues: QualityIssue[]
  narrationSegments: number
  summary: {
    errors: number
    warnings: number
  }
  ttsSegments: number
  version: 1
}

export function createFilmAudioMixArtifact(input: {
  duration: number
  editedSourcePath: string
  outputPath: string
  projectDir: string
  sourceAudioPath?: string
  voiceoverSegments: FilmAudioMixVoiceover[]
}): FilmAudioMix {
  const hasSourceAudio = input.sourceAudioPath !== undefined
  const hasVoiceover = input.voiceoverSegments.length > 0
  const mode = getAudioMixMode(hasSourceAudio, hasVoiceover)

  return {
    ...(mode === 'source-ducked' ? {
      ducking: {
        attackMs: 300,
        ratio: 8,
        releaseMs: 450,
        threshold: 0.03,
      },
    } : {}),
    duration: input.duration,
    generatedAt: new Date().toISOString(),
    loudnessNormalization: FILM_AUDIO_LOUDNESS_NORMALIZATION,
    mode,
    outputPath: toProjectReference(input.projectDir, input.outputPath),
    sourceAudioRetained: hasSourceAudio,
    sourcePath: toProjectReference(input.projectDir, input.editedSourcePath),
    sourceVolume: hasSourceAudio && hasVoiceover ? 0.25 : 0.35,
    ...(hasSourceAudio && hasVoiceover ? {sourceVolumeDuringVoiceover: 0.08} : {}),
    version: 1 as const,
    voiceoverVolume: 1,
    voiceoverSegments: input.voiceoverSegments.map((segment) => ({
      ...segment,
      resolvedPath: toProjectReference(input.projectDir, segment.resolvedPath),
    })),
  }
}

export async function writeFilmSubtitles(workspace: ProjectWorkspace, outputNarration: OutputNarration, outputPath: string): Promise<{
  artifactPath: string
  subtitles: FilmSubtitleOutput
}> {
  const cues = narrationToSrtCues(outputNarration)

  await writeFile(outputPath, narrationToSrt(outputNarration))

  const subtitles = {
    cues: cues.length,
    format: 'srt' as const,
    generatedAt: new Date().toISOString(),
    path: toProjectReference(workspace.projectDir, outputPath),
    version: 1 as const,
  }

  return {
    artifactPath: await workspace.store.writeJson(SUBTITLES_ARTIFACT_NAME, subtitles),
    subtitles,
  }
}

export async function writeFilmRenderOutputArtifact(workspace: ProjectWorkspace, input: {
  audioMix: FilmAudioMix
  editedSourcePath: string
  finalRender: {
    subtitleBurnInIssue?: QualityIssue
    subtitlesBurned: boolean
  }
  outputDuration: number
  outputPath: string
  subtitlePath: string
  subtitles: FilmSubtitleOutput
}): Promise<string> {
  const outputQuality = await inspectRenderedOutput(input.outputPath, {
    expectAudio: true,
    expectedDuration: input.outputDuration,
  })
  const audioQuality = outputQuality.audioStreams > 0 ? await inspectRenderedAudio(input.outputPath) : undefined
  const subtitleQuality = withSubtitleBurnInWarning(checkSrtSubtitles(await readFile(input.subtitlePath, 'utf8'), {
    expectedCues: input.subtitles.cues,
    maxEnd: input.outputDuration,
  }), input.finalRender.subtitleBurnInIssue)

  return workspace.store.writeJson(RENDER_OUTPUT_ARTIFACT_NAME, {
    audioInputs: 1,
    audioMixPath: input.audioMix.outputPath,
    ...(audioQuality === undefined ? {} : {audioQuality}),
    completedAt: new Date().toISOString(),
    outputPath: toProjectReference(workspace.projectDir, input.outputPath),
    outputQuality,
    renderer: FFMPEG_RENDER_OUTPUT_RENDERER,
    source: toProjectReference(workspace.projectDir, input.editedSourcePath),
    subtitlePath: input.subtitles.path,
    subtitleQuality,
    ...(input.finalRender.subtitleBurnInIssue === undefined ? {} : {subtitleBurnInIssue: input.finalRender.subtitleBurnInIssue}),
    subtitlesBurned: input.finalRender.subtitlesBurned,
    version: 1 as const,
  })
}

export function createFilmQualityReport(input: {
  outputNarration: OutputNarration
  outputTimelineMap: OutputTimelineMap
  renderOutput: FilmRenderOutputArtifact
  ttsSegments: TTSSegment[]
}): FilmQualityReport {
  const timeline = {
    duration: input.outputTimelineMap.outputDuration,
    fps: 30,
    items: [],
    version: 1 as const,
  }
  const issues = [
    ...collectFilmRenderIssues(input.renderOutput),
    ...checkNarrationTiming(input.outputNarration, timeline),
    ...checkTtsCoverage(input.outputNarration, input.ttsSegments).filter((issue) => issue.code !== 'tts.duration.mismatch'),
    ...checkFilmTtsDurationBounds(input.outputNarration, input.ttsSegments, input.outputTimelineMap.outputDuration),
  ]

  return {
    checkedAt: new Date().toISOString(),
    issues,
    narrationSegments: input.outputNarration.segments.length,
    summary: countQualityIssues(issues),
    ttsSegments: input.ttsSegments.length,
    version: 1 as const,
  }
}
