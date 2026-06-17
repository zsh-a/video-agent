import type {ReactElement} from 'react'

import {Fragment, createElement as h} from 'react'

import type {TuiCommandSuggestion} from '../../commands/tui.js'

import {EmptyTable, Table} from '../components/Table.js'
import {SectionHeading} from './common.js'

export function CommandsView({commands}: {commands: TuiCommandSuggestion[]}): ReactElement {
  return h(Fragment, null,
    h(SectionHeading, null, 'Guided Commands'),
    commands.length === 0 ? h(EmptyTable, {message: 'none'}) : Table<TuiCommandSuggestion>({
      columns: [
        {header: 'Label', key: 'label', render: (command) => command.label, width: 24},
        {header: 'Command', key: 'command', render: (command) => command.command, width: 64},
      ],
      data: commands,
      maxRows: 14,
      rowKey: (command) => command.id ?? command.command,
    }),
  )
}
