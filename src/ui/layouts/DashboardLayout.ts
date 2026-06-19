import type {ReactElement} from 'react'

import {Box, Text} from 'ink'
import {createElement as h} from 'react'

import type {TuiCommandSuggestion, TuiSnapshot} from '../tui-model.js'
import type {TuiManagerActionDefinition, TuiManagerView} from '../tui-types.js'

import {Badge} from '../components/Badge.js'
import {ConfirmDialog} from '../components/ConfirmDialog.js'
import {List} from '../components/List.js'
import {Panel} from '../components/Panel.js'
import {Spinner} from '../components/Spinner.js'
import {StatusBar} from '../components/StatusBar.js'
import {TabBar} from '../components/TabBar.js'
import {TUI_VIEW_DEFINITIONS} from '../tui-types.js'
import {compactStatus, statusColor, theme} from '../theme.js'
import {ActionsView, ArtifactsView, CommandsView, DashboardView, EventsView, OutputView, ProjectsView, QualityView} from '../views/index.js'

type ProjectSummaryRow = TuiSnapshot['projects'][number]

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
    h(TabBar, {activeView, views: TUI_VIEW_DEFINITIONS}),
    h(Box, {gap: 1},
      h(Panel, {border: activeView === 'projects' ? 'active' : 'default', title: `Projects ${snapshot?.projects.length ?? 0}`, width: 34},
        h(ProjectSidebar, {selectedProjectIndex, snapshot}),
      ),
      h(Panel, {border: 'active', title: getViewLabel(activeView), width: 104},
        h(MainPanel, {
          activeView,
          commands,
          loadingAction,
          output,
          selectedActionIndex,
          selectedArtifactIndex,
          selectedProjectIndex,
          snapshot,
        }),
      ),
    ),
    h(ConfirmDialog, {action: confirmAction}),
    h(StatusBar, {
      error,
      loadingAction,
      message: confirmAction === undefined ? 'Ready' : `${confirmAction.label} requires confirmation`,
      snapshot,
    }),
  )
}

function Header({activeView, loading, snapshot}: {activeView: TuiManagerView; loading: boolean; snapshot?: TuiSnapshot}): ReactElement {
  const selected = snapshot?.selected

  return h(Box, {flexDirection: 'column'},
    h(Box, {justifyContent: 'space-between'},
      h(Box, {gap: 1},
        h(Text, {bold: true}, 'video-agent'),
        h(Text, {dimColor: true}, 'manager'),
        selected === undefined ? null : h(Text, {color: theme.surface.accent}, selected.projectId),
      ),
      loading ? h(Spinner, {label: 'syncing'}) : h(Badge, {label: 'ready', status: 'succeeded'}),
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

function ProjectSidebar({selectedProjectIndex, snapshot}: {selectedProjectIndex: number; snapshot?: TuiSnapshot}): ReactElement {
  const projects = snapshot?.projects ?? []

  return List<ProjectSummaryRow>({
    data: projects,
    detail: (project) => compactStatus(project.status),
    emptyMessage: 'No projects',
    itemColor: (project) => statusColor(project.status),
    maxRows: 12,
    renderItem: (project) => project.projectId,
    rowKey: (project) => project.projectId,
    selected: selectedProjectIndex,
  })
}

function MainPanel({
  activeView,
  commands,
  loadingAction,
  output,
  selectedActionIndex,
  selectedArtifactIndex,
  selectedProjectIndex,
  snapshot,
}: {
  activeView: TuiManagerView
  commands: TuiCommandSuggestion[]
  loadingAction?: string
  output?: string
  selectedActionIndex: number
  selectedArtifactIndex: number
  selectedProjectIndex: number
  snapshot?: TuiSnapshot
}): ReactElement {
  if (activeView === 'dashboard') {
    return h(DashboardView, {snapshot})
  }

  if (activeView === 'projects') {
    return h(ProjectsView, {selectedProjectIndex, snapshot})
  }

  if (activeView === 'events') {
    return h(EventsView, {snapshot})
  }

  if (activeView === 'artifacts') {
    return h(ArtifactsView, {selectedArtifactIndex, snapshot})
  }

  if (activeView === 'quality') {
    return h(QualityView, {snapshot})
  }

  if (activeView === 'actions') {
    return h(ActionsView, {loadingAction, selectedActionIndex, snapshot})
  }

  if (activeView === 'commands') {
    return h(CommandsView, {commands})
  }

  return h(OutputView, {output})
}

function getViewLabel(view: TuiManagerView): string {
  return TUI_VIEW_DEFINITIONS.find((definition) => definition.view === view)?.label ?? view
}
