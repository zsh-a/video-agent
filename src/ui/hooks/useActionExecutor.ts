import {useCallback, useState} from 'react'

import type {TuiManagerActionDefinition, TuiManagerActionRequest, TuiManagerRuntime, TuiManagerView} from '../tui-types.js'

export interface UseActionExecutorOptions {
  getProjectId: () => string | undefined
  refresh: (projectId?: string) => Promise<void>
  runtime: TuiManagerRuntime
  setActiveView: (view: TuiManagerView) => void
}

export interface TuiActionExecutorState {
  cancel: () => void
  confirmAction?: TuiManagerActionDefinition
  error?: string
  executeAction: (action: TuiManagerActionDefinition) => void
  executeRequest: (request: TuiManagerActionRequest) => Promise<void>
  loadingAction?: string
  output?: string
  setError: (error: string | undefined) => void
  setOutput: (output: string | undefined) => void
}

export function useActionExecutor({
  getProjectId,
  refresh,
  runtime,
  setActiveView,
}: UseActionExecutorOptions): TuiActionExecutorState {
  const [confirmAction, setConfirmAction] = useState<TuiManagerActionDefinition | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loadingAction, setLoadingAction] = useState<string | undefined>(undefined)
  const [output, setOutput] = useState<string | undefined>(undefined)

  const executeRequest = useCallback(async (request: TuiManagerActionRequest): Promise<void> => {
    setLoadingAction(request.id)
    setError(undefined)
    setOutput(undefined)
    setActiveView('output')

    try {
      const result = await runtime.runAction(request)
      setOutput(runtime.formatActionResult(result))
      await refresh(request.projectId ?? getProjectId())
    } catch (actionError) {
      setError(formatError(actionError))
    } finally {
      setConfirmAction(undefined)
      setLoadingAction(undefined)
    }
  }, [getProjectId, refresh, runtime, setActiveView])

  const executeAction = useCallback((action: TuiManagerActionDefinition): void => {
    const projectId = getProjectId()

    if (action.projectScoped && projectId === undefined) {
      setError('No focused project is available for this action.')
      return
    }

    if (action.confirm && confirmAction?.id !== action.id) {
      setConfirmAction(action)
      return
    }

    void executeRequest({
      id: action.id,
      projectId,
    })
  }, [confirmAction, executeRequest, getProjectId])

  const cancel = useCallback(() => {
    setConfirmAction(undefined)
    setError(undefined)
  }, [])

  return {
    cancel,
    confirmAction,
    error,
    executeAction,
    executeRequest,
    loadingAction,
    output,
    setError,
    setOutput,
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
