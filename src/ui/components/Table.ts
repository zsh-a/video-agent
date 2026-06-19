import type {ReactElement} from 'react'

import {Box, Text} from 'ink'
import {createElement as h} from 'react'

import {truncateText} from '../format/common.js'
import {symbols, theme} from '../theme.js'

export interface TableColumn<T> {
  align?: 'left' | 'right'
  color?: (item: T) => string | undefined
  header: string
  key: string
  render: (item: T) => string
  width?: number
}

export interface TableProps<T> {
  columns: TableColumn<T>[]
  data: T[]
  header?: boolean
  maxRows?: number
  rowKey?: (item: T, index: number) => string
  selected?: number
}

export function Table<T>({columns, data, header = true, maxRows, rowKey, selected}: TableProps<T>): ReactElement {
  const rows = maxRows === undefined ? data : data.slice(0, maxRows)

  return h(Box, {flexDirection: 'column'},
    header ? h(Box, {gap: 1},
      h(Text, {dimColor: true}, symbols.unselected),
      ...columns.map((column) => h(Text, {
        bold: true,
        dimColor: true,
        key: column.key,
      }, formatCell(column.header, column.width, column.align))),
    ) : null,
    ...rows.map((item, index) => {
      const isSelected = selected === index

      return h(Box, {gap: 1, key: rowKey?.(item, index) ?? String(index)},
        h(Text, {color: isSelected ? theme.surface.accent : undefined}, isSelected ? symbols.selected : symbols.unselected),
        ...columns.map((column) => h(Text, {
          color: isSelected ? theme.surface.accent : column.color?.(item),
          key: column.key,
          wrap: 'truncate-end',
        }, formatCell(column.render(item), column.width, column.align))),
      )
    }),
    rows.length < data.length ? h(Text, {dimColor: true}, `  ${data.length - rows.length} more rows`) : null,
  )
}

export function EmptyTable({message = 'none'}: {message?: string}): ReactElement {
  return h(Text, {dimColor: true}, message)
}

function formatCell(value: string, width: number | undefined, align: 'left' | 'right' = 'left'): string {
  if (width === undefined) {
    return value
  }

  const truncated = truncateText(value.replace(/\s+/g, ' ').trim(), width)

  return align === 'right' ? truncated.padStart(width) : truncated.padEnd(width)
}
