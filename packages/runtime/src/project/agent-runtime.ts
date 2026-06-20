import type {PipelineEvent, ProgressUnit} from '@video-agent/core'
import type {JobStore} from '@video-agent/db'

import {randomUUID} from 'node:crypto'

import type {ProjectWorkspace} from '../shared/workspace.js'

import {appendProjectEvent} from './event-writer.js'

export interface ProjectAgentRuntime {
  completeRun(message?: string): Promise<void>
  completeStage(stage: string, message?: string): Promise<void>
  emit(event: Omit<PipelineEvent, 'projectId' | 'time'> & {time?: string}): Promise<void>
  failRun(error: unknown): Promise<void>
  failStage(stage: string, error: unknown): Promise<void>
  progressStage(stage: string, progress: AgentStepProgress): Promise<void>
  runId: string
  runStep<T>(input: AgentStepInput<T>): Promise<T>
  startRun(message?: string): Promise<void>
  startStage(stage: string, message?: string): Promise<void>
}

export interface AgentStepInput<T> {
  current?: number
  fn: (context: AgentStepExecutionContext) => Promise<T>
  message?: string
  stage: string
  step: string
  total?: number
  unit?: ProgressUnit
}

export interface AgentStepExecutionContext {
  emitProgress(progress: AgentStepProgress): Promise<void>
  stepId: string
}

export interface AgentStepProgress {
  current?: number
  message?: string
  percent?: number
  step?: string
  total?: number
  unit?: ProgressUnit
}

export function createProjectAgentRuntime(input: {
  jobStore: JobStore
  runId?: string
  workspace: ProjectWorkspace
}): ProjectAgentRuntime {
  const runId = input.runId ?? `agent_${randomUUID()}`

  async function emit(event: Omit<PipelineEvent, 'projectId' | 'time'> & {time?: string}): Promise<void> {
    await appendProjectEvent(input.workspace, {
      ...event,
      agentRunId: event.agentRunId ?? runId,
      projectId: input.workspace.projectId,
      time: event.time ?? new Date().toISOString(),
    })
  }

  return {
    async completeRun(message) {
      await emit({
        level: 'info',
        message,
        type: 'agent:run:complete',
      })
    },
    async completeStage(stage, message) {
      await input.jobStore.updateStage(stage, 'completed', message, 1)
      await emit({
        level: 'info',
        message,
        stage,
        type: 'stage:complete',
      })
    },
    emit,
    async failRun(error) {
      await emit({
        level: 'error',
        message: errorMessage(error),
        type: 'agent:run:fail',
      })
    },
    async failStage(stage, error) {
      await input.jobStore.updateStage(stage, 'failed', errorMessage(error), 1)
      await emit({
        level: 'error',
        message: errorMessage(error),
        stage,
        type: 'stage:fail',
      })
    },
    async progressStage(stage, progress) {
      await input.jobStore.updateStageProgress(stage, progress)
      await emit({
        ...progress,
        level: 'info',
        stage,
        type: 'stage:progress',
      })
    },
    runId,
    async runStep(stepInput) {
      const stepId = `step_${randomUUID()}`
      const startedAtMs = Date.now()

      await input.jobStore.updateStage(stepInput.stage, 'running', stepInput.message, 1)
      await input.jobStore.updateStageProgress(stepInput.stage, {
        current: stepInput.current,
        message: stepInput.message,
        step: stepInput.step,
        total: stepInput.total,
        unit: stepInput.unit,
      })
      await emit({
        agentStepId: stepId,
        current: stepInput.current,
        level: 'info',
        message: stepInput.message,
        stage: stepInput.stage,
        step: stepInput.step,
        total: stepInput.total,
        type: 'agent:step:start',
        unit: stepInput.unit,
      })

      const emitProgress = async (progress: AgentStepProgress): Promise<void> => {
        const merged = {
          step: stepInput.step,
          ...progress,
        }

        await input.jobStore.updateStageProgress(stepInput.stage, merged)
        await emit({
          ...merged,
          agentStepId: stepId,
          level: 'info',
          stage: stepInput.stage,
          type: 'agent:step:progress',
        })
      }

      try {
        const result = await stepInput.fn({emitProgress, stepId})

        await emit({
          agentStepId: stepId,
          durationMs: Date.now() - startedAtMs,
          level: 'info',
          stage: stepInput.stage,
          step: stepInput.step,
          type: 'agent:step:complete',
        })

        return result
      } catch (error) {
        await input.jobStore.updateStage(stepInput.stage, 'failed', errorMessage(error), 1)
        await emit({
          agentStepId: stepId,
          durationMs: Date.now() - startedAtMs,
          level: 'error',
          message: errorMessage(error),
          stage: stepInput.stage,
          step: stepInput.step,
          type: 'agent:step:fail',
        })
        throw error
      }
    },
    async startRun(message) {
      await emit({
        level: 'info',
        message,
        type: 'agent:run:start',
      })
    },
    async startStage(stage, message) {
      await input.jobStore.updateStage(stage, 'running', message, 1)
      await emit({
        level: 'info',
        message,
        stage,
        type: 'stage:start',
      })
    },
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
