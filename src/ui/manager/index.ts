import type {ReactElement} from 'react'

import {render, useApp, useInput} from 'ink'
import {createElement as h, useCallback, useEffect, useMemo, useRef, useState} from 'react'

import type {TuiSnapshot} from '../model.js'
import type {LaunchTuiManagerOptions, TuiManagerActionRequest, TuiManagerAppProps} from './types.js'

import {useActionExecutor} from '../hooks/useActionExecutor.js'
import {useNavigation} from '../hooks/useNavigation.js'
import {useProjectSelect} from '../hooks/useProjectSelect.js'
import {TuiManagerScreen} from '../layouts/DashboardLayout.js'
import {MANAGER_ACTIONS, TUI_VIEW_DEFINITIONS} from './types.js'

export type {
  LaunchTuiManagerOptions,
  TuiManagerActionDefinition,
  TuiManagerActionId,
  TuiManagerActionRequest,
  TuiManagerAppProps,
  TuiManagerRuntime,
  TuiManagerView,
} from './types.js'

export {TuiManagerScreen} from '../layouts/DashboardLayout.js'
export type {TuiManagerScreenProps} from '../layouts/DashboardLayout.js'

export async function launchTuiManager(options: LaunchTuiManagerOptions): Promise<void> {
  const instance = render(h(TuiManagerApp, options), {
    exitOnCtrlC: true,
    incrementalRendering: true,
    interactive: true,
    maxFps: 12,
    patchConsole: true,
    stdout: process.stdout,
  })

  await instance.waitUntilExit()
  instance.cleanup()
}

export function TuiManagerApp({initialProjectId, refreshMs, runtime}: TuiManagerAppProps): ReactElement {
  const {exit} = useApp()
  const selectedProjectIdRef = useRef<string | undefined>(initialProjectId)
  const [loading, setLoading] = useState(true)
  const [refreshError, setRefreshError] = useState<string | undefined>(undefined)
  const [selectedActionIndex, setSelectedActionIndex] = useState(0)
  const [selectedArtifactIndex, setSelectedArtifactIndex] = useState(0)
  const [snapshot, setSnapshot] = useState<TuiSnapshot | undefined>(undefined)
  const navigation = useNavigation(TUI_VIEW_DEFINITIONS)

  const refresh = useCallback(async (projectId = selectedProjectIdRef.current): Promise<void> => {
    setLoading(true)
    setRefreshError(undefined)

    try {
      const next = await runtime.readSnapshot(projectId)
      selectedProjectIdRef.current = next.selected?.projectId ?? projectId
      setSnapshot(next)
      setSelectedArtifactIndex((index) => clampIndex(index, next.artifacts.length))
    } catch (refreshFailure) {
      setRefreshError(formatError(refreshFailure))
    } finally {
      setLoading(false)
    }
  }, [runtime])

  const actionExecutor = useActionExecutor({
    getProjectId: () => selectedProjectIdRef.current,
    refresh,
    runtime,
    setActiveView: navigation.setActiveView,
  })
  const projectSelection = useProjectSelect({
    clearOutput: () => actionExecutor.setOutput(undefined),
    initialProjectId,
    refresh,
    setActiveView: navigation.setActiveView,
    snapshot,
  })
  const commands = useMemo(() => snapshot === undefined ? [] : runtime.createCommands(snapshot), [runtime, snapshot])
  const error = actionExecutor.error ?? refreshError

  useEffect(() => {
    selectedProjectIdRef.current = projectSelection.selectedProjectId
  }, [projectSelection.selectedProjectId])

  useEffect(() => {
    void refresh(initialProjectId)
    const interval = setInterval(() => {
      void refresh()
    }, Math.max(1000, refreshMs))

    interval.unref?.()

    return () => {
      clearInterval(interval)
    }
  }, [initialProjectId, refresh, refreshMs])

  useInput((input, key) => {
    if (input === 'q') {
      exit()
      return
    }

    if (key.escape) {
      actionExecutor.cancel()
      return
    }

    if (actionExecutor.confirmAction !== undefined) {
      if (input === 'y' || key.return) {
        actionExecutor.executeAction(actionExecutor.confirmAction)
      } else if (input === 'n') {
        actionExecutor.cancel()
      }

      return
    }

    if (input === 'r') {
      void refresh()
      return
    }

    if (navigation.activeView === 'projects' && key.upArrow) {
      projectSelection.selectProject(-1)
      return
    }

    if (navigation.activeView === 'projects' && key.downArrow) {
      projectSelection.selectProject(1)
      return
    }

    if (navigation.activeView === 'artifacts' && key.upArrow) {
      setSelectedArtifactIndex((index) => clampIndex(index - 1, snapshot?.artifacts.length ?? 0))
      return
    }

    if (navigation.activeView === 'artifacts' && key.downArrow) {
      setSelectedArtifactIndex((index) => clampIndex(index + 1, snapshot?.artifacts.length ?? 0))
      return
    }

    if (navigation.activeView === 'actions' && key.upArrow) {
      setSelectedActionIndex((index) => clampIndex(index - 1, MANAGER_ACTIONS.length))
      return
    }

    if (navigation.activeView === 'actions' && key.downArrow) {
      setSelectedActionIndex((index) => clampIndex(index + 1, MANAGER_ACTIONS.length))
      return
    }

    if (navigation.activeView === 'artifacts' && key.return) {
      openSelectedArtifact({
        executeRequest: actionExecutor.executeRequest,
        selectedArtifactIndex,
        setError: actionExecutor.setError,
        snapshot,
      })
      return
    }

    if (navigation.activeView === 'actions' && key.return) {
      const action = MANAGER_ACTIONS[selectedActionIndex]

      if (action !== undefined) {
        actionExecutor.executeAction(action)
      }
    }
  })

  return h(TuiManagerScreen, {
    activeView: navigation.activeView,
    commands,
    confirmAction: actionExecutor.confirmAction,
    error,
    loading,
    loadingAction: actionExecutor.loadingAction,
    output: actionExecutor.output,
    selectedActionIndex,
    selectedArtifactIndex,
    selectedProjectIndex: projectSelection.selectedProjectIndex,
    snapshot,
  })
}

function openSelectedArtifact({
  executeRequest,
  selectedArtifactIndex,
  setError,
  snapshot,
}: {
  executeRequest: (request: TuiManagerActionRequest) => Promise<void>
  selectedArtifactIndex: number
  setError: (error: string | undefined) => void
  snapshot?: TuiSnapshot
}): void {
  const artifact = snapshot?.artifacts[selectedArtifactIndex]

  if (artifact === undefined) {
    setError('No artifact is selected.')
    return
  }

  void executeRequest({
    artifactName: artifact.name,
    id: 'artifact',
    projectId: snapshot?.selected?.projectId,
  })
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0
  }

  return Math.max(0, Math.min(length - 1, index))
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
