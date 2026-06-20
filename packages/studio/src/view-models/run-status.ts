import type {AgentStep, DashboardData, StageSummary} from '../types'

export type RunViewStatus = 'completed' | 'failed' | 'idle' | 'running'

export type RunStageGroup = {
  name: string
  status: RunViewStatus | 'pending'
  steps: AgentStep[]
}

export type RunViewModel = {
  currentStep?: AgentStep
  headline: string
  outputs: {
    artifacts: number
    llmCalls: number
    qualityErrors: number
    qualityWarnings: number
    renderReady: boolean
  }
  pipeline: string
  progress?: {
    current?: number
    percent?: number
    total?: number
    unit?: string
  }
  projectId?: string
  runMessage?: string
  stageGroups: RunStageGroup[]
  status: RunViewStatus
  updatedAt?: string
}

export function createRunViewModel(data: DashboardData, projectId?: string): RunViewModel {
  const status = data.projectStatus
  const run = status?.agent?.currentRun
  const agentSteps = run?.steps ?? []
  const stageGroups = agentSteps.length > 0
    ? groupAgentSteps(agentSteps)
    : groupJobStages(status?.job.stages ?? [])
  const currentStep = selectCurrentStep(agentSteps)
  const runStatus = normalizeRunStatus(run?.status ?? status?.job.status)

  return {
    currentStep,
    headline: createHeadline(runStatus, currentStep, status?.job.pipeline),
    outputs: createRunOutputs(data),
    pipeline: status?.job.pipeline ?? 'none',
    progress: selectProgress(currentStep, stageGroups),
    projectId,
    runMessage: run?.message,
    stageGroups,
    status: runStatus,
    updatedAt: data.projects.find((project) => project.projectId === projectId)?.updatedAt,
  }
}

function createRunOutputs(data: DashboardData): RunViewModel['outputs'] {
  const status = data.projectStatus

  return {
    artifacts: data.artifacts.length,
    llmCalls: data.providerReport?.llmTraces?.length ?? 0,
    qualityErrors: status?.summary?.quality.errors ?? data.quality?.summary.errors ?? 0,
    qualityWarnings: status?.summary?.quality.warnings ?? data.quality?.summary.warnings ?? 0,
    renderReady: status?.summary?.render.rendered === true,
  }
}

function groupAgentSteps(steps: AgentStep[]): RunStageGroup[] {
  const groups = new Map<string, AgentStep[]>()

  for (const step of steps) {
    const stage = step.stage ?? 'agent'
    groups.set(stage, [...(groups.get(stage) ?? []), step])
  }

  return Array.from(groups.entries()).map(([name, groupSteps]) => ({
    name,
    status: summarizeStepStatus(groupSteps),
    steps: groupSteps,
  }))
}

function groupJobStages(stages: StageSummary[]): RunStageGroup[] {
  return stages.map((stage) => ({
    name: stage.name,
    status: normalizeRunStatus(stage.status) === 'idle' ? 'pending' : normalizeRunStatus(stage.status),
    steps: [{
      completedAt: stage.status === 'completed' ? '' : undefined,
      current: stage.current,
      message: stage.message,
      name: stage.step ?? stage.name,
      percent: stage.percent,
      stage: stage.name,
      startedAt: '',
      status: normalizeStepStatus(stage.status),
      total: stage.total,
      unit: stage.unit,
    }],
  }))
}

function selectCurrentStep(steps: AgentStep[]): AgentStep | undefined {
  return [...steps].reverse().find((step) => step.status === 'running')
    ?? [...steps].reverse().find((step) => step.status === 'failed')
    ?? steps.at(-1)
}

function selectProgress(step: AgentStep | undefined, stageGroups: RunStageGroup[]): RunViewModel['progress'] {
  if (step?.percent !== undefined || step?.current !== undefined || step?.total !== undefined) {
    return {
      current: step.current,
      percent: step.percent,
      total: step.total,
      unit: step.unit,
    }
  }

  const total = stageGroups.reduce((sum, group) => sum + group.steps.length, 0)
  if (total === 0) {
    return undefined
  }

  const completed = stageGroups.reduce((sum, group) => sum + group.steps.filter((groupStep) => groupStep.status === 'completed').length, 0)

  return {
    current: completed,
    percent: Math.round((completed / total) * 100),
    total,
    unit: 'steps',
  }
}

function summarizeStepStatus(steps: AgentStep[]): RunStageGroup['status'] {
  if (steps.some((step) => step.status === 'failed')) return 'failed'
  if (steps.some((step) => step.status === 'running')) return 'running'
  if (steps.length > 0 && steps.every((step) => step.status === 'completed')) return 'completed'

  return 'pending'
}

function normalizeRunStatus(status: string | undefined): RunViewStatus {
  if (status === 'running') return 'running'
  if (status === 'completed' || status === 'complete') return 'completed'
  if (status === 'failed' || status === 'error') return 'failed'

  return 'idle'
}

function normalizeStepStatus(status: string): AgentStep['status'] {
  if (status === 'completed' || status === 'complete') return 'completed'
  if (status === 'failed' || status === 'error') return 'failed'

  return 'running'
}

function createHeadline(status: RunViewStatus, currentStep: AgentStep | undefined, pipeline: string | undefined): string {
  if (currentStep?.message !== undefined) return currentStep.message
  if (currentStep !== undefined) return currentStep.name
  if (pipeline !== undefined) return `${pipeline} ${status}`

  return 'Select a project to inspect its run.'
}
