import type {ArtifactIntegrityResult, ProjectArtifact, ProjectEventRecord, ProjectStatus, ProjectSummary, VideoAgentGuidedAction} from '@video-agent/runtime'

export const TUI_ACTIONS = ['artifact', 'audio', 'commands', 'dashboard', 'events', 'export', 'projects', 'provider-test', 'quality', 'render', 'rerun', 'select', 'status', 'verify', 'visual', 'worker'] as const
export type TuiAction = (typeof TUI_ACTIONS)[number]

export const TUI_COMMAND_ACTIONS = ['commands', 'select'] as const satisfies readonly TuiAction[]
export type TuiCommandAction = (typeof TUI_COMMAND_ACTIONS)[number]

export const TUI_INSPECT_ACTIONS = ['artifact', 'audio', 'events', 'projects', 'provider-test', 'quality', 'status', 'verify', 'visual'] as const satisfies readonly TuiAction[]
export type TuiInspectAction = (typeof TUI_INSPECT_ACTIONS)[number]

export const TUI_OPERATE_ACTIONS = ['export', 'render', 'rerun', 'worker'] as const satisfies readonly TuiAction[]
export type TuiOperateAction = (typeof TUI_OPERATE_ACTIONS)[number]

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

export function isTuiCommandAction(action: TuiAction): action is TuiCommandAction {
  return isTuiActionMember(action, TUI_COMMAND_ACTIONS)
}

export function isTuiInspectAction(action: TuiAction): action is TuiInspectAction {
  return isTuiActionMember(action, TUI_INSPECT_ACTIONS)
}

export function isTuiOperateAction(action: TuiAction): action is TuiOperateAction {
  return isTuiActionMember(action, TUI_OPERATE_ACTIONS)
}

function isTuiActionMember<Action extends TuiAction>(action: TuiAction, actions: readonly Action[]): action is Action {
  return actions.includes(action as Action)
}
