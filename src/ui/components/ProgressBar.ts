import type {ReactElement} from 'react'

import {Text} from 'ink'
import {createElement as h} from 'react'

import {formatPercent} from '../tui-format.js'
import {theme} from '../theme.js'

export interface ProgressBarProps {
  percent: number
  showPercent?: boolean
  width?: number
}

export function ProgressBar({percent, showPercent = true, width = 18}: ProgressBarProps): ReactElement {
  const safePercent = Math.max(0, Math.min(100, percent))
  const filled = Math.round((safePercent / 100) * width)
  const bar = `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
  const suffix = showPercent ? ` ${formatPercent(safePercent)}` : ''

  return h(Text, {color: theme.surface.accent}, `${bar}${suffix}`)
}
