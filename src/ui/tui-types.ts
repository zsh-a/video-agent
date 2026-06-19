import type {TuiActionResult} from './tui-action-types.js'
import type {TuiCommandSuggestion, TuiSnapshot} from './tui-model.js'

export type TuiManagerView = 'actions' | 'artifacts' | 'commands' | 'dashboard' | 'events' | 'output' | 'projects' | 'quality'
export type TuiManagerActionId = 'audio' | 'events' | 'export' | 'provider-test' | 'quality' | 'render' | 'rerun' | 'status' | 'verify' | 'visual' | 'worker-dry-run'

export interface TuiManagerActionRequest {
  artifactName?: string
  id: TuiManagerActionId | 'artifact'
  projectId?: string
}

export interface TuiManagerRuntime {
  createCommands(snapshot: TuiSnapshot): TuiCommandSuggestion[]
  formatActionResult(result: TuiActionResult): string
  readSnapshot(projectId?: string): Promise<TuiSnapshot>
  runAction(request: TuiManagerActionRequest): Promise<TuiActionResult>
}

export interface LaunchTuiManagerOptions {
  initialProjectId?: string
  refreshMs: number
  runtime: TuiManagerRuntime
}

export type TuiManagerAppProps = LaunchTuiManagerOptions

export interface TuiManagerActionDefinition {
  confirm: boolean
  description: string
  group: 'Inspect' | 'Operate'
  id: TuiManagerActionId
  label: string
  projectScoped: boolean
}

export interface TuiManagerViewDefinition {
  label: string
  view: TuiManagerView
}

export const TUI_VIEW_DEFINITIONS: TuiManagerViewDefinition[] = [
  {label: 'Dashboard', view: 'dashboard'},
  {label: 'Projects', view: 'projects'},
  {label: 'Events', view: 'events'},
  {label: 'Artifacts', view: 'artifacts'},
  {label: 'Quality', view: 'quality'},
  {label: 'Actions', view: 'actions'},
  {label: 'Commands', view: 'commands'},
  {label: 'Output', view: 'output'},
]

export const TUI_VIEW_ORDER: TuiManagerView[] = TUI_VIEW_DEFINITIONS.map((definition) => definition.view)

export const MANAGER_ACTIONS: TuiManagerActionDefinition[] = [
  {confirm: false, description: 'Current job state', group: 'Inspect', id: 'status', label: 'Status', projectScoped: true},
  {confirm: false, description: 'Quality report', group: 'Inspect', id: 'quality', label: 'Quality', projectScoped: true},
  {confirm: false, description: 'Recent runtime events', group: 'Inspect', id: 'events', label: 'Events', projectScoped: true},
  {confirm: false, description: 'Manifest and schemas', group: 'Inspect', id: 'verify', label: 'Verify', projectScoped: true},
  {confirm: false, description: 'Audio readiness', group: 'Inspect', id: 'audio', label: 'Audio', projectScoped: true},
  {confirm: false, description: 'Frame samples', group: 'Inspect', id: 'visual', label: 'Visual', projectScoped: true},
  {confirm: false, description: 'Provider smoke test', group: 'Inspect', id: 'provider-test', label: 'Providers', projectScoped: false},
  {confirm: false, description: 'Recovery preview', group: 'Inspect', id: 'worker-dry-run', label: 'Worker dry-run', projectScoped: false},
  {confirm: true, description: 'Run from configured stage', group: 'Operate', id: 'rerun', label: 'Rerun', projectScoped: true},
  {confirm: true, description: 'Create render output', group: 'Operate', id: 'render', label: 'Render', projectScoped: true},
  {confirm: true, description: 'Write export artifact', group: 'Operate', id: 'export', label: 'Export', projectScoped: true},
]
