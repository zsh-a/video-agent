import type {ReactElement} from 'react'

import {Box, Text} from 'ink'
import {createElement as h} from 'react'

import type {TuiSnapshot} from '../../commands/tui.js'

import {Badge} from '../components/Badge.js'
import {formatRender} from '../tui-format.js'
import {theme} from '../theme.js'
import {EmptyView, Field, SectionHeading} from './common.js'

export function QualityView({snapshot}: {snapshot?: TuiSnapshot}): ReactElement {
  const selected = snapshot?.selected
  const integrity = snapshot?.artifactIntegrity

  if (selected === undefined) {
    return h(EmptyView, {message: 'No focused project.'})
  }

  return h(Box, {flexDirection: 'column'},
    h(SectionHeading, null, 'Quality'),
    h(Box, {gap: 2},
      h(Field, {label: 'issues', value: `${selected.summary.quality.issues}`}),
      h(Field, {label: 'errors', value: h(Text, {color: selected.summary.quality.errors > 0 ? theme.status.failed : theme.status.completed}, String(selected.summary.quality.errors))}),
      h(Field, {label: 'warnings', value: h(Text, {color: selected.summary.quality.warnings > 0 ? theme.status.retrying : undefined}, String(selected.summary.quality.warnings))}),
    ),
    integrity === undefined ? null : h(Box, {gap: 2},
      h(Field, {label: 'integrity', value: h(Badge, {label: integrity.ok ? 'clean' : 'attention', status: integrity.ok ? 'completed' : 'warning'})}),
      h(Field, {label: 'checked', value: String(integrity.summary.checked)}),
      h(Field, {label: 'missing', value: String(integrity.summary.missing)}),
      h(Field, {label: 'changed', value: String(integrity.summary.changed)}),
      h(Field, {label: 'schema', value: String(integrity.summary.schemaInvalid)}),
    ),
    h(SectionHeading, null, 'Render'),
    h(Text, {wrap: 'truncate-end'}, formatRender(selected.summary.render)),
  )
}
