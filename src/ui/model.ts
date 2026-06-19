import type {ArtifactIntegrityResult, ProjectArtifact, ProjectEventRecord, ProjectStatus, ProjectSummary, VideoAgentGuidedAction} from '@video-agent/runtime'

export type TuiAction = 'artifact' | 'audio' | 'commands' | 'dashboard' | 'events' | 'export' | 'projects' | 'provider-test' | 'quality' | 'render' | 'rerun' | 'select' | 'status' | 'verify' | 'visual' | 'worker'

export interface TuiSnapshot {
  artifactIntegrity?: ArtifactIntegrityResult
  artifacts: ProjectArtifact[]
  events: ProjectEventRecord[]
  projects: ProjectSummary[]
  selected?: ProjectStatus
  workspaceDir: string
}

export interface FormatTuiSnapshotOptions {
  artifactLimit: number
  commandPrefix: string
  eventLimit: number
}

export type TuiCommandSuggestion = VideoAgentGuidedAction
