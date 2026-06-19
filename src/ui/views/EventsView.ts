import type {ReactElement} from 'react'

import {Fragment, createElement as h} from 'react'

import type {TuiSnapshot} from '../tui-model.js'

import {EmptyTable, Table} from '../components/Table.js'
import {formatEvent} from '../tui-format.js'
import {statusColor} from '../theme.js'
import {SectionHeading} from './common.js'

type EventRow = TuiSnapshot['events'][number]

export function EventsView({snapshot}: {snapshot?: TuiSnapshot}): ReactElement {
  const events = snapshot?.events ?? []

  return h(Fragment, null,
    h(SectionHeading, null, 'Recent Events'),
    events.length === 0 ? h(EmptyTable, {message: 'none'}) : Table<EventRow>({
      columns: [
        {header: 'Kind', key: 'kind', render: (event) => event.kind, width: 9},
        {header: 'Time', key: 'time', render: (event) => event.time, width: 24},
        {header: 'Event', key: 'event', render: formatEvent, width: 58, color: (event) => event.kind === 'provider' ? statusColor(event.event.status) : undefined},
      ],
      data: events,
      maxRows: 14,
      rowKey: (event, index) => `${event.time}:${index}`,
    }),
  )
}
