import type {ReactElement} from 'react'

import {Box, Text} from 'ink'
import {createElement as h} from 'react'

import {SectionHeading} from './common.js'

export function OutputView({output}: {output?: string}): ReactElement {
  const lines = output === undefined || output === '' ? [] : output.split('\n').slice(0, 18)

  return h(Box, {flexDirection: 'column'},
    h(SectionHeading, null, 'Action Output'),
    lines.length === 0
      ? h(Text, {dimColor: true}, 'No action output yet.')
      : lines.map((line, index) => h(Text, {
          key: `${index}:${line}`,
          wrap: 'truncate-end',
        }, line)),
  )
}
