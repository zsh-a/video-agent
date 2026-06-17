import type {ReactElement} from 'react'

import {Box, Text} from 'ink'
import {createElement as h} from 'react'

import {symbols, theme} from '../theme.js'

export interface ListProps<T> {
  data: T[]
  detail?: (item: T) => string | undefined
  disabled?: (item: T) => boolean
  emptyMessage?: string
  itemColor?: (item: T) => string | undefined
  maxRows?: number
  renderItem: (item: T) => string
  rowKey?: (item: T, index: number) => string
  selected?: number
}

export function List<T>({
  data,
  detail,
  disabled,
  emptyMessage = 'none',
  itemColor,
  maxRows,
  renderItem,
  rowKey,
  selected,
}: ListProps<T>): ReactElement {
  const rows = maxRows === undefined ? data : data.slice(0, maxRows)

  if (rows.length === 0) {
    return h(Text, {dimColor: true}, emptyMessage)
  }

  return h(Box, {flexDirection: 'column'},
    ...rows.map((item, index) => {
      const isDisabled = disabled?.(item) ?? false
      const isSelected = selected === index
      const color = isSelected ? theme.surface.accent : itemColor?.(item)

      return h(Box, {gap: 1, key: rowKey?.(item, index) ?? String(index)},
        h(Text, {color}, isSelected ? symbols.selected : symbols.unselected),
        h(Text, {
          bold: isSelected,
          color: isDisabled ? theme.status.pending : color,
          wrap: 'truncate-end',
        }, renderItem(item)),
        detail === undefined ? null : h(Text, {dimColor: true, wrap: 'truncate-end'}, detail(item) ?? ''),
      )
    }),
    rows.length < data.length ? h(Text, {dimColor: true}, `  ${data.length - rows.length} more rows`) : null,
  )
}
