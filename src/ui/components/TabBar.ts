import type {ReactElement} from 'react'

import {Box, Text} from 'ink'
import {createElement as h} from 'react'

import type {TuiManagerView, TuiManagerViewDefinition} from '../tui-types.js'

import {symbols, theme} from '../theme.js'

export interface TabBarProps {
  activeView: TuiManagerView
  views: TuiManagerViewDefinition[]
}

export function TabBar({activeView, views}: TabBarProps): ReactElement {
  return h(Box, {'aria-role': 'tablist', gap: 1},
    ...views.flatMap((definition, index) => {
      const active = definition.view === activeView
      const label = `${index + 1}:${definition.label}`
      const tab = h(Text, {
        color: active ? theme.surface.inverse : theme.surface.accent,
        inverse: active,
        key: definition.view,
      }, ` ${active ? symbols.selected : symbols.unselected} ${label} `)

      if (index === views.length - 1) {
        return [tab]
      }

      return [
        tab,
        h(Text, {dimColor: true, key: `${definition.view}:sep`}, symbols.pipe),
      ]
    }),
  )
}
