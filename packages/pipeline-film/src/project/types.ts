import type {SourceManifest} from '@video-agent/ir'
import type {LLMClient} from '@video-agent/llm'

export interface CreateFilmIngestProjectOptions {
  inputPath: string
  projectId?: string
  trace?: boolean
  workspaceDir?: string
}

export interface CreateFilmIngestProjectResult {
  artifacts: {
    mediaInfo: string
    sourceManifest: string
  }
  projectDir: string
  projectId: string
  sourceManifest: SourceManifest
  status: 'ingested'
}

export interface CreateFilmUnderstandingProjectOptions {
  llmClient?: LLMClient
  maxScenes?: number
  projectId: string
  trace?: boolean
  workspaceDir?: string
}

export interface CreateFilmUnderstandingProjectResult {
  artifacts: {
    asrResult: string
    frames: string
    scenes: string
    silencePeriods: string
    timelineFusion: string
    vlmAnalysis: string
  }
  projectDir: string
  projectId: string
  scenes: number
  status: 'understood'
}

export interface CreateFilmStoryIndexProjectOptions {
  language?: string
  llmClient?: LLMClient
  projectId: string
  workspaceDir?: string
}

export interface CreateFilmStoryIndexProjectResult {
  artifacts: {
    characterIndex: string
    narrativeBeats: string
    storyIndex: string
  }
  beats: number
  projectDir: string
  projectId: string
  status: 'indexed'
}

export interface CreateFilmRecapScriptProjectOptions {
  llmClient?: LLMClient
  projectId: string
  targetDurationSeconds?: number
  workspaceDir?: string
}

export interface CreateFilmRecapScriptProjectResult {
  artifacts: {
    recapScript: string
  }
  projectDir: string
  projectId: string
  segments: number
  status: 'scripted'
  totalEstimatedDuration: number
}

export interface CreateFilmClipPlanProjectOptions {
  projectId: string
  targetDurationSeconds?: number
  workspaceDir?: string
}

export interface CreateFilmClipPlanProjectResult {
  artifacts: {
    clipPlan: string
  }
  clips: number
  duration: number
  projectDir: string
  projectId: string
  status: 'planned'
}
