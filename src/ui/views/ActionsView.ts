import type {ReactElement} from 'react'

import {Fragment, createElement as h} from 'react'

import type {TuiSnapshot} from '../tui-model.js'
import type {TuiManagerActionDefinition} from '../tui-types.js'

import {Table} from '../components/Table.js'
import {MANAGER_ACTIONS} from '../tui-types.js'
import {theme} from '../theme.js'
import {SectionHeading} from './common.js'

export function ActionsView({
  loadingAction,
  selectedActionIndex,
  snapshot,
}: {
  loadingAction?: string
  selectedActionIndex: number
  snapshot?: TuiSnapshot
}): ReactElement {
  return h(Fragment, null,
    h(SectionHeading, null, 'Actions'),
    Table<TuiManagerActionDefinition>({
      columns: [
        {header: 'Group', key: 'group', render: (action: TuiManagerActionDefinition) => action.group, width: 8},
        {header: 'Action', key: 'action', render: (action: TuiManagerActionDefinition) => action.label, width: 18, color: (action) => action.id === loadingAction ? theme.status.running : undefined},
        {header: 'Mode', key: 'mode', render: (action: TuiManagerActionDefinition) => action.id === loadingAction ? 'running' : action.confirm ? 'confirm' : 'read', width: 10, color: (action) => action.confirm ? theme.status.retrying : undefined},
        {header: 'Scope', key: 'scope', render: (action: TuiManagerActionDefinition) => action.projectScoped ? 'project' : 'workspace', width: 10, color: (action) => action.projectScoped && snapshot?.selected === undefined ? theme.status.pending : undefined},
        {header: 'Description', key: 'description', render: (action: TuiManagerActionDefinition) => action.description, width: 34},
      ],
      data: MANAGER_ACTIONS,
      rowKey: (action) => action.id,
      selected: selectedActionIndex,
    }),
  )
}
