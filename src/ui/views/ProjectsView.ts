import type {ReactElement} from 'react'

import {Fragment, createElement as h} from 'react'

import type {TuiSnapshot} from '../tui-model.js'

import {EmptyTable, Table} from '../components/Table.js'
import {compactStatus, statusColor} from '../theme.js'
import {SectionHeading} from './common.js'

type ProjectRow = TuiSnapshot['projects'][number]

export function ProjectsView({selectedProjectIndex, snapshot}: {selectedProjectIndex: number; snapshot?: TuiSnapshot}): ReactElement {
  const projects = snapshot?.projects ?? []

  return h(Fragment, null,
    h(SectionHeading, null, 'Workspace Projects'),
    projects.length === 0 ? h(EmptyTable, {message: 'No projects found.'}) : Table<ProjectRow>({
      columns: [
        {header: 'Name', key: 'name', render: (project) => project.projectId, width: 30},
        {header: 'Status', key: 'status', render: (project) => compactStatus(project.status), width: 12, color: (project) => statusColor(project.status)},
        {header: 'Updated', key: 'updated', render: (project) => project.updatedAt ?? '-', width: 26},
      ],
      data: projects,
      maxRows: 16,
      rowKey: (project) => project.projectId,
      selected: selectedProjectIndex,
    }),
  )
}
