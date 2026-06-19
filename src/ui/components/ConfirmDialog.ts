import type {ReactElement} from 'react'

import {Box, Text} from 'ink'
import {createElement as h} from 'react'

import type {TuiManagerActionDefinition} from '../manager/types.js'

import {theme} from '../theme.js'
import {Panel} from './Panel.js'

export interface ConfirmDialogProps {
  action?: TuiManagerActionDefinition
}

export function ConfirmDialog({action}: ConfirmDialogProps): ReactElement | null {
  if (action === undefined) {
    return null
  }

  return h(Panel, {border: 'active', title: 'Confirm'},
    h(Box, {gap: 1},
      h(Text, {color: theme.status.retrying}, action.label),
      h(Text, {wrap: 'truncate-end'}, action.description),
    ),
    h(Text, {dimColor: true}, 'y/Enter run  n/Esc cancel'),
  )
}
