import type {ReactElement} from 'react'

import {Text} from 'ink'
import {createElement as h, useEffect, useState} from 'react'

import {theme} from '../theme.js'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export interface SpinnerProps {
  label?: string
  now?: number
}

export function Spinner({label, now}: SpinnerProps): ReactElement {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (now !== undefined) {
      return undefined
    }

    const interval = setInterval(() => setTick((value) => value + 1), 120)
    interval.unref?.()

    return () => clearInterval(interval)
  }, [now])

  const frame = SPINNER_FRAMES[Math.floor((now ?? tick * 120) / 120) % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0]

  return h(Text, {color: theme.status.running}, `${frame}${label === undefined ? '' : ` ${label}`}`)
}
