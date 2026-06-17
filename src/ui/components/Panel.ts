import type {ReactElement, ReactNode} from 'react'

import {Box, Text} from 'ink'
import {createElement as h} from 'react'

import {borderColor, type TuiBorderTone, theme} from '../theme.js'

export interface PanelProps {
  border?: TuiBorderTone
  children?: ReactNode
  height?: number
  subtitle?: string
  title?: string
  width?: number | string
}

export function Panel({border = 'default', children, height, subtitle, title, width}: PanelProps): ReactElement {
  return h(Box, {
    borderColor: borderColor(border),
    borderDimColor: border === 'default',
    borderStyle: 'single',
    flexDirection: 'column',
    height,
    paddingX: 1,
    width,
  },
  title === undefined ? null : h(Box, {gap: 1},
    h(Text, {bold: true, color: border === 'active' ? theme.surface.accent : undefined}, title),
    subtitle === undefined ? null : h(Text, {dimColor: true, wrap: 'truncate-end'}, subtitle),
  ),
  children)
}
