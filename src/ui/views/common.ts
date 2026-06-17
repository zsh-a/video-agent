import type {ReactElement, ReactNode} from 'react'

import {Box, Text} from 'ink'
import {createElement as h} from 'react'

import {symbols} from '../theme.js'

export function SectionHeading({children}: {children: ReactNode}): ReactElement {
  return h(Box, {gap: 1, marginTop: 1},
    h(Text, {dimColor: true}, symbols.horizontal.repeat(2)),
    h(Text, {bold: true}, children),
  )
}

export function EmptyView({message}: {message: string}): ReactElement {
  return h(Text, {dimColor: true}, message)
}

export function Field({label, value}: {label: string; value: ReactNode}): ReactElement {
  return h(Box, {gap: 1},
    h(Text, {dimColor: true}, label),
    typeof value === 'string' ? h(Text, {wrap: 'truncate-end'}, value) : value,
  )
}
