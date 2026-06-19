import type {Dispatch, MutableRefObject, SetStateAction} from 'react'

import {useCallback, useEffect, useRef, useState} from 'react'

import type {TuiSnapshot} from '../model.js'
import type {TuiManagerView} from '../manager/types.js'

export interface UseProjectSelectOptions {
  clearOutput: () => void
  initialProjectId?: string
  refresh: (projectId?: string) => Promise<void>
  setActiveView: (view: TuiManagerView) => void
  snapshot?: TuiSnapshot
}

export interface TuiProjectSelectionState {
  selectedProjectId?: string
  selectedProjectIdRef: MutableRefObject<string | undefined>
  selectedProjectIndex: number
  selectProject: (offset: number) => void
  setSelectedProjectIndex: Dispatch<SetStateAction<number>>
}

export function useProjectSelect({
  clearOutput,
  initialProjectId,
  refresh,
  setActiveView,
  snapshot,
}: UseProjectSelectOptions): TuiProjectSelectionState {
  const [selectedProjectIndex, setSelectedProjectIndex] = useState(0)
  const selectedProjectId = snapshot?.selected?.projectId ?? initialProjectId
  const selectedProjectIdRef = useRef<string | undefined>(selectedProjectId)
  selectedProjectIdRef.current = selectedProjectId

  useEffect(() => {
    if (snapshot === undefined) {
      return
    }

    setSelectedProjectIndex(Math.max(0, snapshot.projects.findIndex((project) => project.projectId === snapshot.selected?.projectId)))
  }, [snapshot])

  const selectProject = useCallback((offset: number) => {
    if (snapshot === undefined || snapshot.projects.length === 0) {
      return
    }

    const index = wrapIndex(selectedProjectIndex + offset, snapshot.projects.length)
    const projectId = snapshot.projects[index]?.projectId

    setSelectedProjectIndex(index)
    setActiveView('dashboard')
    clearOutput()

    if (projectId !== undefined) {
      void refresh(projectId)
    }
  }, [clearOutput, refresh, selectedProjectIndex, setActiveView, snapshot])

  return {
    selectedProjectId,
    selectedProjectIdRef,
    selectedProjectIndex,
    selectProject,
    setSelectedProjectIndex,
  }
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0
  }

  return ((index % length) + length) % length
}
