import type {FilmPipelineStage, RecoverFilmWorkspaceJobResult, FilmRecoveryOrderBy, FilmRecoveryStatusOption, RerunFilmProjectResult} from '@video-agent/pipeline-film'
import type {PipelineEventType} from '@video-agent/core'
import type {ArtifactIntegrityResult, ExportFormat, ExportProjectResult, FfmpegAudioDiagnostics, ProjectEventKind, ProjectEventsResult, ProjectQualityReport, ProjectStatus, ProjectSummary, ProjectVisualSamplesReport, ProviderCallRole, ProviderCallStatus, ProviderSmokeTestReport, ProviderSmokeTestRoleOption, ReadProjectArtifactResult, RenderProjectResult} from '@video-agent/runtime'
import type {TuiAction, TuiCommandSuggestion} from '../model.js'

import type {createCheckpointErrorPayload} from '../../utils/checkpoint-errors.js'
import type {createExportQualityFailurePayload} from '../../utils/export-output.js'

export type TuiQualityReport = ProjectQualityReport & {qualityReport?: unknown; renderOutput?: unknown}

export interface ReadTuiSnapshotOptions {
  artifactLimit: number
  eventLimit?: number
  projectId?: string
  workspaceDir: string
}

export interface RunTuiActionOptions {
  action: TuiAction
  artifactLimit: number
  artifactName?: string
  commandPrefix: string
  dryRun?: boolean
  eventKind?: ProjectEventKind
  eventLimit?: number
  eventPipelineStage?: string
  eventPipelineType?: PipelineEventType
  eventProviderRole?: ProviderCallRole
  eventProviderStatus?: ProviderCallStatus
  exportCleanOutput?: boolean
  exportFormat?: ExportFormat
  exportOutputPath?: string
  exportRequireQuality: boolean
  framePath?: string
  fromStage?: FilmPipelineStage
  limit?: number
  maxAttempts?: number
  mediaPath?: string
  orderBy?: FilmRecoveryOrderBy
  projectId?: string
  providerRole: ProviderSmokeTestRoleOption
  qualityDetails?: boolean
  renderAudio?: boolean
  renderAudioDucking?: boolean
  renderDuckingAttackMs?: number
  renderDuckingRatio?: number
  renderDuckingReleaseMs?: number
  renderDuckingThreshold?: number
  renderOutputPath?: string
  renderSourceVolume?: number
  renderSubtitles?: boolean
  renderVoiceoverVolume?: number
  runningStaleAfterMs?: number
  status: FilmRecoveryStatusOption
  text?: string
  visualIncludeContent?: boolean
  workspaceDir: string
}

export type TuiCheckpointErrorActionResult = {action: 'rerun'; error: ReturnType<typeof createCheckpointErrorPayload>['error']; projectId: string; type: 'checkpoint-error'}
export type TuiExportQualityErrorActionResult = {action: 'export'; error: ReturnType<typeof createExportQualityFailurePayload>['error']; projectId: string; quality: ProjectQualityReport; type: 'export-quality-error'}
export type TuiActionResult =
  | TuiCheckpointErrorActionResult
  | TuiExportQualityErrorActionResult
  | {artifact: ReadProjectArtifactResult['artifact']; content: unknown; projectId: string; type: 'artifact'}
  | {commands: TuiCommandSuggestion[]; selected?: TuiCommandSuggestion; type: 'select'}
  | {commands: TuiCommandSuggestion[]; type: 'commands'}
  | {diagnostics: FfmpegAudioDiagnostics; projectId: string; type: 'audio'}
  | {dryRun: boolean; recovered: number; results: RecoverFilmWorkspaceJobResult[]; skipped: number; type: 'worker'}
  | {fromStage?: FilmPipelineStage; projectId: string; status: RerunFilmProjectResult['status']; type: 'rerun'}
  | {projectId: string; result: ArtifactIntegrityResult; type: 'verify'}
  | {projects: ProjectSummary[]; type: 'projects'}
  | {report: ProjectVisualSamplesReport; type: 'visual'}
  | {report: ProviderSmokeTestReport; type: 'provider-test'}
  | {report: TuiQualityReport; type: 'quality'}
  | {result: ExportProjectResult; type: 'export'}
  | {result: ProjectEventsResult; type: 'events'}
  | {result: RenderProjectResult; type: 'render'}
  | {status: ProjectStatus; type: 'status'}
  | {type: 'dashboard'}
