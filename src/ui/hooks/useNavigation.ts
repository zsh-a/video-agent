import {useInput} from 'ink'
import {useCallback, useMemo, useState} from 'react'

import type {TuiManagerView, TuiManagerViewDefinition} from '../manager/types.js'

export interface UseNavigationOptions {
  enabled?: boolean
  initialView?: TuiManagerView
}

export interface TuiNavigationState {
  activeIndex: number
  activeView: TuiManagerView
  setActiveIndex: (index: number) => void
  setActiveView: (view: TuiManagerView) => void
}

export function useNavigation(views: TuiManagerViewDefinition[], options: UseNavigationOptions = {}): TuiNavigationState {
  const initialIndex = Math.max(0, views.findIndex((definition) => definition.view === options.initialView))
  const [activeIndex, setActiveIndexState] = useState(initialIndex)
  const enabled = options.enabled ?? true
  const activeView = views[activeIndex]?.view ?? views[0]?.view ?? 'dashboard'

  const setActiveIndex = useCallback((index: number) => {
    setActiveIndexState(clampIndex(index, views.length))
  }, [views.length])

  const setActiveView = useCallback((view: TuiManagerView) => {
    const index = views.findIndex((definition) => definition.view === view)

    if (index >= 0) {
      setActiveIndexState(index)
    }
  }, [views])

  const navigation = useMemo(() => ({
    previous: () => setActiveIndexState((index) => clampIndex(index - 1, views.length)),
    next: () => setActiveIndexState((index) => clampIndex(index + 1, views.length)),
    cycle: (offset: number) => setActiveIndexState((index) => wrapIndex(index + offset, views.length)),
  }), [views.length])

  useInput((input, key) => {
    if (key.tab) {
      navigation.cycle(key.shift ? -1 : 1)
      return
    }

    if (key.leftArrow) {
      navigation.previous()
      return
    }

    if (key.rightArrow) {
      navigation.next()
      return
    }

    const numericShortcut = Number.parseInt(input, 10)

    if (Number.isInteger(numericShortcut) && numericShortcut >= 1 && numericShortcut <= views.length) {
      setActiveIndexState(numericShortcut - 1)
    }
  }, {isActive: enabled})

  return {
    activeIndex,
    activeView,
    setActiveIndex,
    setActiveView,
  }
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0
  }

  return Math.max(0, Math.min(length - 1, index))
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0
  }

  return ((index % length) + length) % length
}
