import type {ReactElement} from 'react'

import {Fragment, createElement as h} from 'react'

import type {TuiSnapshot} from '../model.js'

import {EmptyTable, Table} from '../components/Table.js'
import {formatBytes} from '../format/common.js'
import {SectionHeading} from './common.js'

type ArtifactRow = TuiSnapshot['artifacts'][number]

export function ArtifactsView({selectedArtifactIndex, snapshot}: {selectedArtifactIndex: number; snapshot?: TuiSnapshot}): ReactElement {
  const artifacts = snapshot?.artifacts ?? []

  return h(Fragment, null,
    h(SectionHeading, null, 'Artifacts'),
    artifacts.length === 0 ? h(EmptyTable, {message: 'none'}) : Table<ArtifactRow>({
      columns: [
        {header: 'Name', key: 'name', render: (artifact) => artifact.name, width: 38},
        {header: 'Kind', key: 'kind', render: (artifact) => artifact.kind, width: 6},
        {align: 'right', header: 'Size', key: 'size', render: (artifact) => formatBytes(artifact.size), width: 10},
        {header: 'Updated', key: 'updated', render: (artifact) => artifact.updatedAt, width: 24},
      ],
      data: artifacts,
      maxRows: 14,
      rowKey: (artifact) => artifact.name,
      selected: selectedArtifactIndex,
    }),
  )
}
