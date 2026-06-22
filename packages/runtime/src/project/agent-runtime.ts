import type {JobStore} from '@video-agent/db'

import {
  PIPELINE_EVENT_AGENT_RUN_COMPLETE,
  PIPELINE_EVENT_AGENT_RUN_FAIL,
  PIPELINE_EVENT_AGENT_RUN_START,
  PIPELINE_EVENT_AGENT_STEP_COMPLETE,
  PIPELINE_EVENT_AGENT_STEP_FAIL,
  PIPELINE_EVENT_AGENT_STEP_PROGRESS,
  PIPELINE_EVENT_AGENT_STEP_START,
  PIPELINE_EVENT_STAGE_COMPLETE,
  PIPELINE_EVENT_STAGE_FAIL,
  PIPELINE_EVENT_STAGE_PROGRESS,
  PIPELINE_EVENT_STAGE_SKIP,
  PIPELINE_EVENT_STAGE_START,
  type PipelineEvent,
  type PipelineEventType,
  type ProgressUnit,
} from '@video-agent/core'
import {JOB_STATUS_COMPLETED, JOB_STATUS_FAILED, JOB_STATUS_RUNNING, JOB_STATUS_SKIPPED} from '@video-agent/db'
import {randomUUID} from 'node:crypto'

import type {ProjectWorkspace} from '../shared/workspace.js'

import {appendProjectEvent} from './event-writer.js'

export interface ProjectAgentRuntime {
  completeRun(message?: string): Promise<void>
  completeStage(stage: string, message?: string): Promise<void>
  emit(event: ProjectAgentExternalEvent): Promise<void>
  failRun(error: unknown): Promise<void>
  failStage(stage: string, error: unknown): Promise<void>
  progressStage(stage: string, progress: AgentStepProgress): Promise<void>
  runId: string
  runStep<T>(input: AgentStepInput<T>): Promise<T>
  skipStage(stage: string, message?: string): Promise<void>
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

type AgentPipelineEventType =
  | typeof PIPELINE_EVENT_AGENT_RUN_COMPLETE
  | typeof PIPELINE_EVENT_AGENT_RUN_FAIL
  | typeof PIPELINE_EVENT_AGENT_RUN_START
  | typeof PIPELINE_EVENT_AGENT_STEP_COMPLETE
  | typeof PIPELINE_EVENT_AGENT_STEP_FAIL
  | typeof PIPELINE_EVENT_AGENT_STEP_PROGRESS
  | typeof PIPELINE_EVENT_AGENT_STEP_START

type ProjectAgentOwnedEvent = Omit<PipelineEvent, 'agentRunId' | 'projectId' | 'time'> & {
  agentRunId?: never
  time?: never
}

type ProjectAgentExternalEvent = Omit<ProjectAgentOwnedEvent, 'type'> & {
  type: Exclude<PipelineEventType, AgentPipelineEventType>
}

export function createProjectAgentRuntime(input: {
  jobStore: JobStore
  runId?: string
  workspace: ProjectWorkspace
}): ProjectAgentRuntime {
  const runId = input.runId === undefined ? `agent_${randomUUID()}` : requireAgentRunId(input.runId)

  async function writeEvent(event: ProjectAgentOwnedEvent): Promise<void> {
    const cleanEvent = cleanOwnedEvent(event)
    const candidate = event as {agentRunId?: unknown; time?: unknown}
    if (candidate.agentRunId !== undefined) {
      throw new Error('Project agent runtime owns agentRunId; no emitted event run-id override fallback is allowed.')
    }
    if (candidate.time !== undefined) {
      throw new Error('Project agent runtime owns event time; no emitted timestamp override fallback is allowed.')
    }

    await appendProjectEvent(input.workspace, {
      ...cleanEvent,
      ...(isAgentEventType(cleanEvent.type) ? {agentRunId: runId} : {}),
      projectId: input.workspace.projectId,
      time: new Date().toISOString(),
    })
  }

  async function emit(event: ProjectAgentExternalEvent): Promise<void> {
    if (isAgentEventType(event.type)) {
      throw new Error('Project agent runtime lifecycle owns agent events; use run lifecycle methods instead of external agent event fallback.')
    }

    await writeEvent(event)
  }

  return {
    async completeRun(message) {
      const cleanMessage = readOptionalCleanEventText(message, 'completeRun.message')
      await writeEvent({
        level: 'info',
        message: cleanMessage,
        type: PIPELINE_EVENT_AGENT_RUN_COMPLETE,
      })
    },
    async completeStage(stage, message) {
      const stageName = requireCleanEventText(stage, 'completeStage.stage')
      const cleanMessage = readOptionalCleanEventText(message, 'completeStage.message')

      await input.jobStore.updateStage(stageName, JOB_STATUS_COMPLETED, cleanMessage, 1)
      await writeEvent({
        level: 'info',
        message: cleanMessage,
        stage: stageName,
        type: PIPELINE_EVENT_STAGE_COMPLETE,
      })
    },
    emit,
    async failRun(error) {
      const message = requireCleanEventText(errorMessage(error), 'failRun.message')
      const state = await input.jobStore.read()
      const runningStages = state.stages.filter((stage) => stage.status === JOB_STATUS_RUNNING)

      await runningStages.reduce(
        async (previous, stage) => {
          await previous
          await input.jobStore.updateStage(stage.name, JOB_STATUS_FAILED, message, stage.attempt)
        },
        Promise.resolve(),
      )

      await input.jobStore.complete(JOB_STATUS_FAILED)
      await writeEvent({
        level: 'error',
        message,
        type: PIPELINE_EVENT_AGENT_RUN_FAIL,
      })
    },
    async failStage(stage, error) {
      const stageName = requireCleanEventText(stage, 'failStage.stage')
      const message = requireCleanEventText(errorMessage(error), 'failStage.message')

      await input.jobStore.updateStage(stageName, JOB_STATUS_FAILED, message, 1)
      await writeEvent({
        level: 'error',
        message,
        stage: stageName,
        type: PIPELINE_EVENT_STAGE_FAIL,
      })
    },
    async progressStage(stage, progress) {
      const stageName = requireCleanEventText(stage, 'progressStage.stage')
      const cleanProgress = cleanAgentStepProgress(progress, 'progressStage.progress')

      await input.jobStore.updateStageProgress(stageName, cleanProgress)
      await writeEvent({
        ...cleanProgress,
        level: 'info',
        stage: stageName,
        type: PIPELINE_EVENT_STAGE_PROGRESS,
      })
    },
    runId,
    async runStep(stepInput) {
      const stageName = requireCleanEventText(stepInput.stage, 'runStep.stage')
      const stepName = requireCleanEventText(stepInput.step, 'runStep.step')
      const message = readOptionalCleanEventText(stepInput.message, 'runStep.message')
      const stepId = `step_${randomUUID()}`
      const startedAtMs = Date.now()

      await input.jobStore.updateStage(stageName, JOB_STATUS_RUNNING, message, 1)
      await input.jobStore.updateStageProgress(stageName, {
        current: stepInput.current,
        message,
        step: stepName,
        total: stepInput.total,
        unit: stepInput.unit,
      })
      await writeEvent({
        agentStepId: stepId,
        current: stepInput.current,
        level: 'info',
        message,
        stage: stageName,
        step: stepName,
        total: stepInput.total,
        type: PIPELINE_EVENT_AGENT_STEP_START,
        unit: stepInput.unit,
      })

      const emitProgress = async (progress: AgentStepProgress): Promise<void> => {
        const merged = cleanAgentStepProgress({
          step: stepName,
          ...progress,
        }, 'runStep.progress')

        await input.jobStore.updateStageProgress(stageName, merged)
        await writeEvent({
          ...merged,
          agentStepId: stepId,
          level: 'info',
          stage: stageName,
          type: PIPELINE_EVENT_AGENT_STEP_PROGRESS,
        })
      }

      try {
        const result = await stepInput.fn({emitProgress, stepId})

        await writeEvent({
          agentStepId: stepId,
          durationMs: Date.now() - startedAtMs,
          level: 'info',
          stage: stageName,
          step: stepName,
          type: PIPELINE_EVENT_AGENT_STEP_COMPLETE,
        })

        return result
      } catch (error) {
        const failureMessage = requireCleanEventText(errorMessage(error), 'runStep.failureMessage')

        await input.jobStore.updateStage(stageName, JOB_STATUS_FAILED, failureMessage, 1)
        await writeEvent({
          agentStepId: stepId,
          durationMs: Date.now() - startedAtMs,
          level: 'error',
          message: failureMessage,
          stage: stageName,
          step: stepName,
          type: PIPELINE_EVENT_AGENT_STEP_FAIL,
        })
        throw error
      }
    },
    async skipStage(stage, message) {
      const stageName = requireCleanEventText(stage, 'skipStage.stage')
      const cleanMessage = readOptionalCleanEventText(message, 'skipStage.message')

      await input.jobStore.updateStage(stageName, JOB_STATUS_SKIPPED, cleanMessage, 1)
      await writeEvent({
        level: 'info',
        message: cleanMessage,
        stage: stageName,
        type: PIPELINE_EVENT_STAGE_SKIP,
      })
    },
    async startRun(message) {
      const cleanMessage = readOptionalCleanEventText(message, 'startRun.message')
      await writeEvent({
        level: 'info',
        message: cleanMessage,
        type: PIPELINE_EVENT_AGENT_RUN_START,
      })
    },
    async startStage(stage, message) {
      const stageName = requireCleanEventText(stage, 'startStage.stage')
      const cleanMessage = readOptionalCleanEventText(message, 'startStage.message')

      await input.jobStore.updateStage(stageName, JOB_STATUS_RUNNING, cleanMessage, 1)
      await writeEvent({
        level: 'info',
        message: cleanMessage,
        stage: stageName,
        type: PIPELINE_EVENT_STAGE_START,
      })
    },
  }
}

function isAgentEventType(type: PipelineEvent['type']): boolean {
  return type === PIPELINE_EVENT_AGENT_RUN_COMPLETE
    || type === PIPELINE_EVENT_AGENT_RUN_FAIL
    || type === PIPELINE_EVENT_AGENT_RUN_START
    || type === PIPELINE_EVENT_AGENT_STEP_COMPLETE
    || type === PIPELINE_EVENT_AGENT_STEP_FAIL
    || type === PIPELINE_EVENT_AGENT_STEP_PROGRESS
    || type === PIPELINE_EVENT_AGENT_STEP_START
}

function requireAgentRunId(value: string): string {
  if (value === '' || value.trim() !== value) {
    throw new Error('Project agent runtime runId must be clean non-empty text; no agent run id cleanup fallback is allowed.')
  }

  return value
}

function cleanOwnedEvent(event: ProjectAgentOwnedEvent): ProjectAgentOwnedEvent {
  return {
    ...event,
    ...(event.agentStepId === undefined ? {} : {agentStepId: requireCleanEventText(event.agentStepId, `${event.type}.agentStepId`)}),
    ...(event.message === undefined ? {} : {message: requireCleanEventText(event.message, `${event.type}.message`)}),
    ...(event.parentStepId === undefined ? {} : {parentStepId: requireCleanEventText(event.parentStepId, `${event.type}.parentStepId`)}),
    ...(event.stage === undefined ? {} : {stage: requireCleanEventText(event.stage, `${event.type}.stage`)}),
    ...(event.step === undefined ? {} : {step: requireCleanEventText(event.step, `${event.type}.step`)}),
    ...(event.toolCallId === undefined ? {} : {toolCallId: requireCleanEventText(event.toolCallId, `${event.type}.toolCallId`)}),
  }
}

function cleanAgentStepProgress(progress: AgentStepProgress, field: string): AgentStepProgress {
  return {
    ...progress,
    ...(progress.message === undefined ? {} : {message: requireCleanEventText(progress.message, `${field}.message`)}),
    ...(progress.step === undefined ? {} : {step: requireCleanEventText(progress.step, `${field}.step`)}),
  }
}

function readOptionalCleanEventText(value: string | undefined, field: string): string | undefined {
  return value === undefined ? undefined : requireCleanEventText(value, field)
}

function requireCleanEventText(value: string, field: string): string {
  if (value === '' || value.trim() !== value) {
    throw new Error(`Project agent runtime event field ${field} must be clean non-empty text; no event text cleanup fallback is allowed.`)
  }

  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
