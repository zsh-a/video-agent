import type {ReactElement} from 'react'

import {Box, Text} from 'ink'
import {createElement as h} from 'react'

import {compactStatus, statusColor, statusSymbol} from '../theme.js'

export interface BadgeProps {
  label?: string
  status?: string
}

export function Badge({label, status}: BadgeProps): ReactElement {
  const color = statusColor(status)

  return h(Box, {gap: 1},
    h(Text, {color}, statusSymbol(status)),
    h(Text, {color}, label ?? compactStatus(status)),
  )
}
