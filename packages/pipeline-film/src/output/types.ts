import type {LLMClient} from '@video-agent/llm'
import type {FilmAudioMix, FilmSubtitleOutput} from '@video-agent/ir'
import type {TTSSegment} from '@video-agent/providers'
import type {FfmpegRenderOutputRenderer} from '@video-agent/runtime'

import type {FilmQualityReport} from './artifacts.js'

export interface CreateFilmCutProjectOptions {
  projectId: string
  workspaceDir?: string
}

export interface CreateFilmCutProjectResult {
  artifacts: {
    clipPlanValidated: string
    outputTimelineMap: string
  }
  outputPath: string
  projectDir: string
  projectId: string
  status: 'cut'
}

export interface CreateFilmOutputNarrationProjectOptions {
  language?: string
  projectId: string
  workspaceDir?: string
}

export interface CreateFilmOutputNarrationProjectResult {
  artifacts: {
    outputNarration: string
  }
  projectDir: string
  projectId: string
  segments: number
  status: 'narrated'
}

export interface CreateFilmVoiceoverProjectOptions {
  llmClient?: LLMClient
  projectId: string
  trace?: boolean
  workspaceDir?: string
}

export interface CreateFilmVoiceoverProjectResult {
  artifacts: {
    ttsSegments: string
  }
  projectDir: string
  projectId: string
  segments: number
  status: 'voiced'
  ttsSegments: TTSSegment[]
}

export interface CreateFilmAudioMixProjectOptions {
  projectId: string
  workspaceDir?: string
}

export interface CreateFilmAudioMixProjectResult {
  artifacts: {
    audioMix: string
  }
  audioMix: FilmAudioMix
  outputPath: string
  projectDir: string
  projectId: string
  status: 'mixed'
}

export interface CreateFilmSubtitleProjectOptions {
  projectId: string
  workspaceDir?: string
}

export interface CreateFilmSubtitleProjectResult {
  artifacts: {
    subtitles: string
  }
  outputPath: string
  projectDir: string
  projectId: string
  status: 'subtitled'
  subtitles: FilmSubtitleOutput
}

export interface CreateFilmFinalRenderProjectOptions {
  projectId: string
  workspaceDir?: string
}

export interface CreateFilmFinalRenderProjectResult {
  artifactPath: string
  audioInputs: number
  outputPath: string
  projectDir: string
  projectId: string
  renderer: FfmpegRenderOutputRenderer
  status: 'rendered'
  subtitlePath: string
}

export interface CreateFilmQualityCheckProjectOptions {
  projectId: string
  workspaceDir?: string
}

export type {FilmQualityReport}

export interface CreateFilmQualityCheckProjectResult {
  artifactPath: string
  projectDir: string
  projectId: string
  qualityReport: FilmQualityReport
  status: 'checked'
}
