export type TuiBorderTone = 'active' | 'default' | 'error'
export type TuiStatusTone = 'completed' | 'failed' | 'pending' | 'retrying' | 'running' | 'skipped' | 'succeeded' | 'warning'

export const symbols = {
  arrow: '→',
  bottomLeft: '└',
  bottomRight: '┘',
  bullet: '•',
  cross: '┼',
  dot: '·',
  failure: '✗',
  horizontal: '─',
  info: '◆',
  pending: '○',
  pipe: '│',
  running: '●',
  selected: '▸',
  success: '✓',
  teeLeft: '┤',
  teeRight: '├',
  topLeft: '┌',
  topRight: '┐',
  unselected: ' ',
  vertical: '│',
  warning: '▲',
} as const

export const theme = {
  border: {
    active: 'cyan',
    default: 'gray',
    error: 'red',
  },
  priority: {
    high: 'red',
    low: 'gray',
    medium: 'yellow',
  },
  status: {
    completed: 'green',
    failed: 'red',
    pending: 'gray',
    retrying: 'yellow',
    running: 'cyan',
    skipped: 'gray',
    succeeded: 'green',
    warning: 'yellow',
  },
  surface: {
    accent: 'cyan',
    inverse: 'black',
    primary: 'white',
    secondary: 'gray',
  },
} as const

export function statusColor(status: string | undefined): string | undefined {
  if (status === 'completed' || status === 'succeeded') {
    return theme.status.completed
  }

  if (status === 'failed') {
    return theme.status.failed
  }

  if (status === 'running') {
    return theme.status.running
  }

  if (status === 'retrying') {
    return theme.status.retrying
  }

  if (status === 'pending' || status === 'skipped' || status === undefined) {
    return theme.status.pending
  }

  return undefined
}

export function statusSymbol(status: string | undefined): string {
  if (status === 'completed' || status === 'succeeded') {
    return symbols.success
  }

  if (status === 'failed') {
    return symbols.failure
  }

  if (status === 'running' || status === 'retrying') {
    return symbols.running
  }

  if (status === 'warning') {
    return symbols.warning
  }

  if (status === 'skipped') {
    return symbols.dot
  }

  return symbols.pending
}

export function compactStatus(status: string | undefined): string {
  if (status === undefined) {
    return 'unknown'
  }

  if (status === 'completed') {
    return 'done'
  }

  if (status === 'succeeded') {
    return 'ok'
  }

  return status
}

export function borderColor(tone: TuiBorderTone | undefined): string {
  return theme.border[tone ?? 'default']
}
