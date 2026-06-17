import type {TuiActionResult, TuiCommandSuggestion, TuiSnapshot} from '../commands/tui.js'
import type {ReactElement} from 'react'

import {Box, Text, render, useApp, useInput} from 'ink'
import {Fragment, createElement as h, useEffect, useMemo, useRef, useState} from 'react'

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

export interface TuiManagerScreenProps {
  activeView: TuiManagerView
  commands: TuiCommandSuggestion[]
  confirmAction?: TuiManagerActionDefinition
  error?: string
  loading: boolean
  loadingAction?: string
  output?: string
  selectedActionIndex: number
  selectedArtifactIndex: number
  selectedProjectIndex: number
  snapshot?: TuiSnapshot
}

export interface TuiManagerActionDefinition {
  confirm: boolean
  description: string
  group: 'Inspect' | 'Operate'
  id: TuiManagerActionId
  label: string
  projectScoped: boolean
}

const VIEW_ORDER: TuiManagerView[] = ['dashboard', 'projects', 'events', 'artifacts', 'quality', 'actions', 'commands', 'output']
const NAV_ITEMS: Array<{key: string; label: string; view: TuiManagerView}> = [
  {key: 'd', label: 'Dashboard', view: 'dashboard'},
  {key: 'p', label: 'Projects', view: 'projects'},
  {key: 'e', label: 'Events', view: 'events'},
  {key: 'f', label: 'Artifacts', view: 'artifacts'},
  {key: 'g', label: 'Quality', view: 'quality'},
  {key: 'x', label: 'Actions', view: 'actions'},
  {key: 'c', label: 'Commands', view: 'commands'},
  {key: 'o', label: 'Output', view: 'output'},
]
const MANAGER_ACTIONS: TuiManagerActionDefinition[] = [
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

export async function launchTuiManager(options: LaunchTuiManagerOptions): Promise<void> {
  const instance = render(h(TuiManagerApp, options), {
    exitOnCtrlC: true,
    incrementalRendering: true,
    interactive: true,
    maxFps: 12,
    patchConsole: true,
    stdout: process.stdout,
  })

  await instance.waitUntilExit()
  instance.cleanup()
}

export function TuiManagerApp({initialProjectId, refreshMs, runtime}: TuiManagerAppProps): ReactElement {
  const {exit} = useApp()
  const [activeView, setActiveView] = useState<TuiManagerView>('dashboard')
  const [confirmAction, setConfirmAction] = useState<TuiManagerActionDefinition | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [loadingAction, setLoadingAction] = useState<string | undefined>(undefined)
  const [output, setOutput] = useState<string | undefined>(undefined)
  const [selectedActionIndex, setSelectedActionIndex] = useState(0)
  const [selectedArtifactIndex, setSelectedArtifactIndex] = useState(0)
  const [selectedProjectIndex, setSelectedProjectIndex] = useState(0)
  const [snapshot, setSnapshot] = useState<TuiSnapshot | undefined>(undefined)
  const selectedProjectIdRef = useRef<string | undefined>(initialProjectId)

  const commands = useMemo(() => snapshot === undefined ? [] : runtime.createCommands(snapshot), [runtime, snapshot])
  const selectedProjectId = snapshot?.selected?.projectId ?? initialProjectId
  selectedProjectIdRef.current = selectedProjectId

  const refresh = async (projectId = selectedProjectIdRef.current): Promise<void> => {
    setLoading(true)
    setError(undefined)

    try {
      const next = await runtime.readSnapshot(projectId)
      selectedProjectIdRef.current = next.selected?.projectId ?? projectId
      setSnapshot(next)
      setSelectedProjectIndex(Math.max(0, next.projects.findIndex((project) => project.projectId === next.selected?.projectId)))
      setSelectedArtifactIndex((index) => clampIndex(index, next.artifacts.length))
    } catch (refreshError) {
      setError(formatError(refreshError))
    } finally {
      setLoading(false)
    }
  }

  const selectProject = (offset: number): void => {
    if (snapshot === undefined || snapshot.projects.length === 0) {
      return
    }

    const index = wrapIndex(selectedProjectIndex + offset, snapshot.projects.length)
    const projectId = snapshot.projects[index]?.projectId

    setSelectedProjectIndex(index)
    setActiveView('dashboard')
    setOutput(undefined)

    if (projectId !== undefined) {
      void refresh(projectId)
    }
  }

  const executeRequest = async (request: TuiManagerActionRequest): Promise<void> => {
    setLoadingAction(request.id)
    setError(undefined)
    setOutput(undefined)
    setActiveView('output')

    try {
      const result = await runtime.runAction(request)
      setOutput(runtime.formatActionResult(result))
      await refresh(request.projectId ?? selectedProjectId)
    } catch (actionError) {
      setError(formatError(actionError))
    } finally {
      setConfirmAction(undefined)
      setLoadingAction(undefined)
    }
  }

  const executeAction = (action: TuiManagerActionDefinition): void => {
    const projectId = snapshot?.selected?.projectId

    if (action.projectScoped && projectId === undefined) {
      setError('No focused project is available for this action.')
      return
    }

    if (action.confirm && confirmAction?.id !== action.id) {
      setConfirmAction(action)
      return
    }

    void executeRequest({
      id: action.id,
      projectId,
    })
  }

  const openSelectedArtifact = (): void => {
    const artifact = snapshot?.artifacts[selectedArtifactIndex]

    if (artifact === undefined) {
      setError('No artifact is selected.')
      return
    }

    void executeRequest({
      artifactName: artifact.name,
      id: 'artifact',
      projectId: snapshot?.selected?.projectId,
    })
  }

  useEffect(() => {
    void refresh(initialProjectId)
    const interval = setInterval(() => {
      void refresh()
    }, Math.max(1000, refreshMs))

    interval.unref?.()

    return () => {
      clearInterval(interval)
    }
  }, [initialProjectId, refreshMs])

  // eslint-disable-next-line complexity
  useInput((input, key) => {
    if (input === 'q') {
      exit()
      return
    }

    if (key.escape) {
      setConfirmAction(undefined)
      setError(undefined)
      return
    }

    if (confirmAction !== undefined) {
      if (input === 'y' || key.return) {
        executeAction(confirmAction)
      } else if (input === 'n') {
        setConfirmAction(undefined)
      }

      return
    }

    if (input === 'r') {
      void refresh()
      return
    }

    if (key.tab) {
      setActiveView((view) => VIEW_ORDER[(VIEW_ORDER.indexOf(view) + 1) % VIEW_ORDER.length] ?? 'dashboard')
      return
    }

    if (input === 'd') {
      setActiveView('dashboard')
      return
    }

    if (input === 'p') {
      setActiveView('projects')
      return
    }

    if (input === 'e') {
      setActiveView('events')
      return
    }

    if (input === 'f') {
      setActiveView('artifacts')
      return
    }

    if (input === 'g') {
      setActiveView('quality')
      return
    }

    if (input === 'x') {
      setActiveView('actions')
      return
    }

    if (input === 'c') {
      setActiveView('commands')
      return
    }

    if (input === 'o') {
      setActiveView('output')
      return
    }

    if (activeView === 'projects' && key.upArrow) {
      selectProject(-1)
      return
    }

    if (activeView === 'projects' && key.downArrow) {
      selectProject(1)
      return
    }

    if (activeView === 'artifacts' && key.upArrow) {
      setSelectedArtifactIndex((index) => clampIndex(index - 1, snapshot?.artifacts.length ?? 0))
      return
    }

    if (activeView === 'artifacts' && key.downArrow) {
      setSelectedArtifactIndex((index) => clampIndex(index + 1, snapshot?.artifacts.length ?? 0))
      return
    }

    if (activeView === 'actions' && key.upArrow) {
      setSelectedActionIndex((index) => clampIndex(index - 1, MANAGER_ACTIONS.length))
      return
    }

    if (activeView === 'actions' && key.downArrow) {
      setSelectedActionIndex((index) => clampIndex(index + 1, MANAGER_ACTIONS.length))
      return
    }

    if (activeView === 'artifacts' && key.return) {
      openSelectedArtifact()
      return
    }

    if (activeView === 'actions' && key.return) {
      const action = MANAGER_ACTIONS[selectedActionIndex]

      if (action !== undefined) {
        executeAction(action)
      }
    }
  })

  return h(TuiManagerScreen, {
    activeView,
    commands,
    confirmAction,
    error,
    loading,
    loadingAction,
    output,
    selectedActionIndex,
    selectedArtifactIndex,
    selectedProjectIndex,
    snapshot,
  })
}

export function TuiManagerScreen({
  activeView,
  commands,
  confirmAction,
  error,
  loading,
  loadingAction,
  output,
  selectedActionIndex,
  selectedArtifactIndex,
  selectedProjectIndex,
  snapshot,
}: TuiManagerScreenProps): ReactElement {
  return h(Box, {flexDirection: 'column', gap: 1},
    h(Header, {activeView, loading, snapshot}),
    h(Navigation, {activeView}),
    h(Box, {gap: 2},
      h(ProjectSidebar, {selectedProjectIndex, snapshot}),
      h(MainPanel, {
        activeView,
        commands,
        loadingAction,
        output,
        selectedActionIndex,
        selectedArtifactIndex,
        snapshot,
      }),
    ),
    h(StatusLine, {confirmAction, error, loadingAction}),
    h(Footer),
  )
}

function Header({activeView, loading, snapshot}: {activeView: TuiManagerView; loading: boolean; snapshot?: TuiSnapshot}) {
  const selected = snapshot?.selected

  return h(Box, {flexDirection: 'column'},
    h(Box, {justifyContent: 'space-between'},
      h(Box, {gap: 1},
        h(Text, {bold: true}, 'video-agent'),
        h(Text, {dimColor: true}, 'manager'),
        selected === undefined ? null : h(Text, {color: 'cyan'}, selected.projectId),
      ),
      h(Box, {gap: 1},
        loading ? h(Text, {color: 'yellow'}, 'syncing') : h(Text, {color: 'green'}, 'ready'),
      ),
    ),
    h(Box, {gap: 2},
      h(Text, {dimColor: true}, 'projects'),
      h(Text, null, String(snapshot?.projects.length ?? 0)),
      h(Text, {dimColor: true}, 'view'),
      h(Text, null, activeView),
      h(Text, {dimColor: true}, 'workspace'),
      h(Text, {wrap: 'truncate-end'}, snapshot?.workspaceDir ?? 'loading'),
    ),
  )
}

function Navigation({activeView}: {activeView: TuiManagerView}) {
  return h(Box, {gap: 1},
    ...NAV_ITEMS.map((item) => h(Text, {
      color: item.view === activeView ? 'black' : 'cyan',
      dimColor: item.view !== activeView,
      inverse: item.view === activeView,
      key: item.view,
    }, ` ${item.label} `)),
  )
}

function ProjectSidebar({selectedProjectIndex, snapshot}: {selectedProjectIndex: number; snapshot?: TuiSnapshot}) {
  const projects = snapshot?.projects ?? []

  return h(Box, {flexDirection: 'column', width: 30},
    h(SectionTitle, {title: `Projects ${projects.length}`}),
    projects.length === 0
      ? h(Text, {dimColor: true}, 'No projects')
      : projects.slice(0, 12).map((project, index) => h(Box, {key: project.projectId, gap: 1},
        h(Text, {color: index === selectedProjectIndex ? 'cyan' : undefined}, index === selectedProjectIndex ? '>' : ' '),
        h(Text, {
          bold: project.projectId === snapshot?.selected?.projectId,
          color: projectStatusColor(project.status),
          wrap: 'truncate-end',
        }, project.projectId),
        h(Text, {dimColor: true}, compactStatus(project.status)),
      )),
  )
}

function MainPanel(props: {
  activeView: TuiManagerView
  commands: TuiCommandSuggestion[]
  loadingAction?: string
  output?: string
  selectedActionIndex: number
  selectedArtifactIndex: number
  snapshot?: TuiSnapshot
}) {
  const {activeView, commands, loadingAction, output, selectedActionIndex, selectedArtifactIndex, snapshot} = props

  return h(Box, {flexDirection: 'column', width: 94},
    activeView === 'dashboard' ? h(DashboardView, {snapshot}) : null,
    activeView === 'projects' ? h(ProjectsView, {snapshot}) : null,
    activeView === 'events' ? h(EventsView, {snapshot}) : null,
    activeView === 'artifacts' ? h(ArtifactsView, {selectedArtifactIndex, snapshot}) : null,
    activeView === 'quality' ? h(QualityView, {snapshot}) : null,
    activeView === 'actions' ? h(ActionsView, {loadingAction, selectedActionIndex, snapshot}) : null,
    activeView === 'commands' ? h(CommandsView, {commands}) : null,
    activeView === 'output' ? h(OutputView, {output}) : null,
  )
}

function DashboardView({snapshot}: {snapshot?: TuiSnapshot}) {
  const selected = snapshot?.selected

  if (selected === undefined) {
    return h(EmptyView, {message: 'No focused project.'})
  }

  return h(Fragment, null,
    h(SectionTitle, {title: selected.projectId}),
    h(SummaryBar, {snapshot}),
    h(Text, {dimColor: true, wrap: 'truncate-end'}, selected.job.inputPath),
    h(SectionTitle, {title: 'Pipeline'}),
    ...selected.job.stages.slice(0, 10).map((stage) => h(Box, {gap: 1, key: stage.name},
      h(Text, {color: stageStatusColor(stage.status)}, stageStatusMark(stage.status)),
      h(Text, {bold: stage.status === 'running'}, stage.name.padEnd(18)),
      h(Text, {dimColor: stage.status !== 'failed'}, `${stage.status}${stage.attempt === undefined ? '' : ` attempt ${stage.attempt}`}${stage.message === undefined ? '' : ` ${stage.message}`}`),
    )),
  )
}

function ProjectsView({snapshot}: {snapshot?: TuiSnapshot}) {
  const projects = snapshot?.projects ?? []

  if (projects.length === 0) {
    return h(EmptyView, {message: 'No projects found.'})
  }

  return h(Fragment, null,
    h(SectionTitle, {title: 'Workspace Projects'}),
    ...projects.slice(0, 16).map((project) => h(Text, {
      color: project.projectId === snapshot?.selected?.projectId ? 'cyan' : undefined,
      key: project.projectId,
      wrap: 'truncate-end',
    }, `${project.projectId === snapshot?.selected?.projectId ? '>' : ' '} ${project.projectId.padEnd(26)} ${project.status ?? 'unknown'} ${project.updatedAt ?? '-'}`)),
  )
}

function EventsView({snapshot}: {snapshot?: TuiSnapshot}) {
  const events = snapshot?.events ?? []

  return h(Fragment, null,
    h(SectionTitle, {title: 'Recent Events'}),
    events.length === 0 ? h(Text, {dimColor: true}, 'none') : events.slice(0, 14).map((event, index) => h(Text, {
      key: `${event.time}:${index}`,
      wrap: 'truncate-end',
    }, formatEvent(event))),
  )
}

function ArtifactsView({selectedArtifactIndex, snapshot}: {selectedArtifactIndex: number; snapshot?: TuiSnapshot}) {
  const artifacts = snapshot?.artifacts ?? []

  return h(Fragment, null,
    h(SectionTitle, {title: 'Artifacts'}),
    artifacts.length === 0 ? h(Text, {dimColor: true}, 'none') : artifacts.slice(0, 14).map((artifact, index) => h(Text, {
      color: index === selectedArtifactIndex ? 'cyan' : undefined,
      key: artifact.name,
      wrap: 'truncate-end',
    }, `${index === selectedArtifactIndex ? '>' : ' '} ${artifact.name.padEnd(34)} ${artifact.kind.padEnd(5)} ${artifact.size}B`)),
  )
}

function QualityView({snapshot}: {snapshot?: TuiSnapshot}) {
  const selected = snapshot?.selected
  const integrity = snapshot?.artifactIntegrity

  if (selected === undefined) {
    return h(EmptyView, {message: 'No focused project.'})
  }

  return h(Fragment, null,
    h(SectionTitle, {title: 'Quality'}),
    h(SummaryBar, {snapshot}),
    integrity === undefined ? null : h(Box, {gap: 1},
      h(Text, {color: integrity.ok ? 'green' : 'yellow'}, integrity.ok ? 'clean' : 'attention'),
      h(Text, null, `checked ${integrity.summary.checked}`),
      h(Text, {dimColor: integrity.summary.missing === 0}, `missing ${integrity.summary.missing}`),
      h(Text, {dimColor: integrity.summary.changed === 0}, `changed ${integrity.summary.changed}`),
      h(Text, {dimColor: integrity.summary.schemaInvalid === 0}, `schema ${integrity.summary.schemaInvalid}`),
    ),
    h(Text, null, `render ${formatRender(selected.summary.render)}`),
  )
}

function ActionsView({loadingAction, selectedActionIndex, snapshot}: {loadingAction?: string; selectedActionIndex: number; snapshot?: TuiSnapshot}) {
  const inspectActions = MANAGER_ACTIONS.filter((action) => action.group === 'Inspect')
  const operateActions = MANAGER_ACTIONS.filter((action) => action.group === 'Operate')

  return h(Fragment, null,
    h(SectionTitle, {title: 'Actions'}),
    h(ActionGroup, {
      actions: inspectActions,
      loadingAction,
      offset: 0,
      selectedActionIndex,
      snapshot,
      title: 'Inspect',
    }),
    h(ActionGroup, {
      actions: operateActions,
      loadingAction,
      offset: inspectActions.length,
      selectedActionIndex,
      snapshot,
      title: 'Operate',
    }),
  )
}

function CommandsView({commands}: {commands: TuiCommandSuggestion[]}) {
  return h(Fragment, null,
    h(SectionTitle, {title: 'Guided Commands'}),
    commands.length === 0 ? h(Text, {dimColor: true}, 'none') : commands.slice(0, 14).map((command) => h(Text, {
      key: command.id ?? command.command,
      wrap: 'truncate-end',
    }, `${command.label.padEnd(24)} ${command.command}`)),
  )
}

function OutputView({output}: {output?: string}) {
  return h(Fragment, null,
    h(SectionTitle, {title: 'Action Output'}),
    output === undefined || output === '' ? h(Text, {dimColor: true}, 'No action output yet.') : output.split('\n').slice(0, 18).map((line, index) => h(Text, {
      key: `${index}:${line}`,
      wrap: 'truncate-end',
    }, line)),
  )
}

function SummaryBar({snapshot}: {snapshot?: TuiSnapshot}) {
  const selected = snapshot?.selected

  if (selected === undefined) {
    return h(Text, {dimColor: true}, 'No project selected.')
  }

  return h(Box, {gap: 2},
    h(Box, {gap: 1},
      h(Text, {dimColor: true}, 'job'),
      h(Text, {color: projectStatusColor(selected.job.status)}, selected.job.status),
    ),
    h(Box, {gap: 1},
      h(Text, {dimColor: true}, 'quality'),
      h(Text, {color: selected.summary.quality.errors > 0 ? 'red' : selected.summary.quality.warnings > 0 ? 'yellow' : 'green'}, `${selected.summary.quality.issues}/${selected.summary.quality.errors}e`),
    ),
    h(Box, {gap: 1},
      h(Text, {dimColor: true}, 'providers'),
      h(Text, {color: selected.summary.providers.failed > 0 ? 'red' : undefined}, `${selected.summary.providers.total}/${selected.summary.providers.failed}f`),
    ),
    h(Box, {gap: 1},
      h(Text, {dimColor: true}, 'artifacts'),
      h(Text, null, String(selected.artifacts.length)),
    ),
    h(Box, {gap: 1},
      h(Text, {dimColor: true}, 'render'),
      h(Text, null, formatRender(selected.summary.render)),
    ),
  )
}

function ActionGroup({
  actions,
  loadingAction,
  offset,
  selectedActionIndex,
  snapshot,
  title,
}: {
  actions: TuiManagerActionDefinition[]
  loadingAction?: string
  offset: number
  selectedActionIndex: number
  snapshot?: TuiSnapshot
  title: string
}) {
  return h(Box, {flexDirection: 'column', marginTop: offset === 0 ? 0 : 1},
    h(Text, {bold: true, dimColor: true}, title),
    ...actions.map((action, index) => {
      const globalIndex = offset + index
      const disabled = action.projectScoped && snapshot?.selected === undefined
      const running = loadingAction === action.id
      const selected = globalIndex === selectedActionIndex

      return h(Box, {gap: 1, key: action.id},
        h(Text, {color: selected ? 'cyan' : undefined}, selected ? '>' : ' '),
        h(Text, {
          bold: selected,
          color: disabled ? 'gray' : undefined,
        }, action.label.padEnd(16)),
        h(Text, {
          color: action.confirm ? 'yellow' : undefined,
          dimColor: !action.confirm,
        }, running ? 'running' : action.confirm ? 'confirm' : 'read'),
        h(Text, {dimColor: true, wrap: 'truncate-end'}, action.description),
      )
    }),
  )
}

function StatusLine({confirmAction, error, loadingAction}: {confirmAction?: TuiManagerActionDefinition; error?: string; loadingAction?: string}) {
  if (confirmAction !== undefined) {
    return h(Text, {color: 'yellow'}, `${confirmAction.label} requires confirmation: y/enter to run, n/esc to cancel.`)
  }

  if (error !== undefined) {
    return h(Text, {color: 'red', wrap: 'truncate-end'}, error)
  }

  if (loadingAction !== undefined) {
    return h(Text, {color: 'yellow'}, `Running ${loadingAction}...`)
  }

  return h(Text, {dimColor: true}, 'Ready')
}

function Footer() {
  return h(Text, {dimColor: true}, 'q quit  r refresh  tab next  enter open/run  esc cancel')
}

function SectionTitle({title}: {title: string}) {
  return h(Text, {bold: true}, title)
}

function EmptyView({message}: {message: string}) {
  return h(Text, {dimColor: true}, message)
}

function projectStatusColor(status: string | undefined): string | undefined {
  if (status === 'completed') {
    return 'green'
  }

  if (status === 'failed') {
    return 'red'
  }

  if (status === 'running') {
    return 'cyan'
  }

  return undefined
}

function compactStatus(status: string | undefined): string {
  if (status === undefined) {
    return 'unknown'
  }

  if (status === 'completed') {
    return 'done'
  }

  return status
}

function stageStatusColor(status: string): string | undefined {
  if (status === 'completed') {
    return 'green'
  }

  if (status === 'failed') {
    return 'red'
  }

  if (status === 'running') {
    return 'cyan'
  }

  return 'gray'
}

function stageStatusMark(status: string): string {
  if (status === 'completed') {
    return 'done'
  }

  if (status === 'failed') {
    return 'fail'
  }

  if (status === 'running') {
    return 'run '
  }

  return 'wait'
}

function formatRender(render: NonNullable<TuiSnapshot['selected']>['summary']['render']): string {
  if (!render.rendered) {
    return 'none'
  }

  return `${render.renderer ?? 'unknown'} (${render.outputErrors} output errors, ${render.visualErrors} visual errors)`
}

function formatEvent(event: TuiSnapshot['events'][number]): string {
  if (event.kind === 'pipeline') {
    return `${event.time} pipeline ${event.event.type}${event.event.stage === undefined ? '' : ` ${event.event.stage}`}${event.event.message === undefined ? '' : ` ${event.event.message}`}`
  }

  return `${event.time} provider ${event.event.role} ${event.event.operation} ${event.event.status} ${event.event.durationMs}ms`
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0
  }

  return Math.max(0, Math.min(length - 1, index))
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0
  }

  return ((index % length) + length) % length
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
