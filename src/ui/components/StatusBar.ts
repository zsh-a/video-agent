import type {ReactElement} from 'react'

import {Box, Text} from 'ink'
import {createElement as h} from 'react'

import {formatIssueSummary} from '../tui-format.js'
import {symbols, theme} from '../theme.js'

import type {TuiSnapshot} from '../tui-model.js'

export interface StatusBarProps {
  error?: string
  loadingAction?: string
  message?: string
  snapshot?: TuiSnapshot
}

export function StatusBar({error, loadingAction, message = 'Ready', snapshot}: StatusBarProps): ReactElement {
  const selectedProjectId = snapshot?.selected?.projectId ?? 'none'
  const statusMessage = formatStatusMessage(error, loadingAction, message)

  return h(Box, {flexDirection: 'column'},
    h(Text, {dimColor: true}, 'q quit  ↑↓ navigate  ← → tabs  Tab next  1-8 jump  Enter select  r refresh  Esc cancel'),
    h(Text, {dimColor: true}, symbols.horizontal.repeat(72)),
    h(Box, {gap: 1},
      h(Text, {color: error === undefined ? undefined : theme.status.failed, wrap: 'truncate-end'}, statusMessage),
      h(Text, {dimColor: true}, symbols.dot),
      h(Text, {dimColor: true}, `project: ${selectedProjectId}`),
      h(Text, {dimColor: true}, symbols.dot),
      h(Text, {dimColor: true}, formatIssueSummary(snapshot)),
    ),
  )
}

function formatStatusMessage(error: string | undefined, loadingAction: string | undefined, message: string): string {
  if (error !== undefined) {
    return error
  }

  if (loadingAction !== undefined) {
    return `Running ${loadingAction}...`
  }

  return message
}
