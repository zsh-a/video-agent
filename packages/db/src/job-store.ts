import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'

export const JOB_STATUS_COMPLETED = 'completed' as const
export const JOB_STATUS_FAILED = 'failed' as const
export const JOB_STATUS_PENDING = 'pending' as const
export const JOB_STATUS_RUNNING = 'running' as const
export const JOB_STATUS_SKIPPED = 'skipped' as const

export const JOB_RUN_STATUSES = [JOB_STATUS_COMPLETED, JOB_STATUS_FAILED, JOB_STATUS_RUNNING] as const
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number]

export const JOB_STAGE_STATUSES = [JOB_STATUS_COMPLETED, JOB_STATUS_FAILED, JOB_STATUS_PENDING, JOB_STATUS_RUNNING, JOB_STATUS_SKIPPED] as const
export type JobStageStatus = (typeof JOB_STAGE_STATUSES)[number]

export const TERMINAL_JOB_RUN_STATUSES = [JOB_STATUS_COMPLETED, JOB_STATUS_FAILED] as const satisfies readonly JobRunStatus[]
export const TERMINAL_JOB_STAGE_STATUSES = [JOB_STATUS_COMPLETED, JOB_STATUS_FAILED, JOB_STATUS_SKIPPED] as const satisfies readonly JobStageStatus[]
export const MESSAGE_JOB_STAGE_STATUSES = [JOB_STATUS_FAILED, JOB_STATUS_RUNNING, JOB_STATUS_SKIPPED] as const satisfies readonly JobStageStatus[]

export interface JobStageState {
  attempt?: number
  completedAt?: string
  current?: number
  message?: string
  name: string
  percent?: number
  startedAt?: string
  status: JobStageStatus
  step?: string
  total?: number
  unit?: string
}

export interface JobState {
  completedAt?: string
  createdAt: string
  inputPath: string
  pipeline: string
  projectId: string
  stages: JobStageState[]
  status: JobRunStatus
  updatedAt: string
  version: 1
}

export interface InitializeJobOptions {
  inputPath: string
  pipeline: string
  projectId: string
  stages: readonly string[]
}

export interface JobStore {
  complete(status: JobRunStatus): Promise<JobState>
  initialize(options: InitializeJobOptions): Promise<JobState>
  read(): Promise<JobState>
  updateStage(name: string, status: JobStageStatus, message?: string, attempt?: number): Promise<JobState>
  updateStageProgress(name: string, progress: JobStageProgress): Promise<JobState>
}

export interface JobStageProgress {
  current?: number
  message?: string
  percent?: number
  step?: string
  total?: number
  unit?: string
}

export function normalizeJobStageProgress(progress: JobStageProgress): JobStageProgress {
  const normalized: JobStageProgress = {
    ...(progress.current === undefined ? {} : {current: readProgressNumber(progress.current, 'current')}),
    ...(progress.message === undefined ? {} : {message: readProgressString(progress.message, 'message')}),
    ...(progress.percent === undefined ? {} : {percent: readProgressPercent(progress.percent)}),
    ...(progress.step === undefined ? {} : {step: readProgressString(progress.step, 'step')}),
    ...(progress.total === undefined ? {} : {total: readProgressNumber(progress.total, 'total')}),
    ...(progress.unit === undefined ? {} : {unit: readProgressString(progress.unit, 'unit')}),
  }

  if (normalized.current !== undefined && normalized.total !== undefined && normalized.current > normalized.total) {
    throw new Error(`Job stage progress current (${normalized.current}) must not exceed total (${normalized.total}); no progress clamp fallback is allowed.`)
  }

  return normalized
}

export function deriveJobRunStatus(stages: readonly {status: JobStageStatus}[]): JobRunStatus {
  if (stages.some((stage) => stage.status === JOB_STATUS_FAILED)) {
    return JOB_STATUS_FAILED
  }

  return stages.every((stage) => isTerminalJobStageStatus(stage.status)) ? JOB_STATUS_COMPLETED : JOB_STATUS_RUNNING
}

export function isTerminalJobStageStatus(status: JobStageStatus): boolean {
  return (TERMINAL_JOB_STAGE_STATUSES as readonly JobStageStatus[]).includes(status)
}

export function isTerminalJobRunStatus(status: JobRunStatus): boolean {
  return (TERMINAL_JOB_RUN_STATUSES as readonly JobRunStatus[]).includes(status)
}

export function isMessageJobStageStatus(status: JobStageStatus): boolean {
  return (MESSAGE_JOB_STAGE_STATUSES as readonly JobStageStatus[]).includes(status)
}

export function isJobRunStatus(value: unknown): value is JobRunStatus {
  return typeof value === 'string' && (JOB_RUN_STATUSES as readonly string[]).includes(value)
}

export function isJobStageStatus(value: unknown): value is JobStageStatus {
  return typeof value === 'string' && (JOB_STAGE_STATUSES as readonly string[]).includes(value)
}

export class JsonJobStore implements JobStore {
  constructor(private readonly path: string) {}

  async complete(status: JobRunStatus): Promise<JobState> {
    const state = await this.read()
    const updated = {
      ...state,
      completedAt: new Date().toISOString(),
      status,
      updatedAt: new Date().toISOString(),
    }

    await this.write(updated)

    return updated
  }

  async initialize(options: InitializeJobOptions): Promise<JobState> {
    const now = new Date().toISOString()
    const existing = await this.readOptional()
    const state: JobState = {
      completedAt: undefined,
      createdAt: existing?.createdAt ?? now,
      inputPath: options.inputPath,
      pipeline: options.pipeline,
      projectId: options.projectId,
      stages: options.stages.map((stage) => existing?.stages.find((existingStage) => existingStage.name === stage) ?? {name: stage, status: JOB_STATUS_PENDING}),
      status: JOB_STATUS_RUNNING,
      updatedAt: now,
      version: 1,
    }

    await this.write(state)

    return state
  }

  async read(): Promise<JobState> {
    return parseJobState(await readRequiredJobStateJson(this.path))
  }

  async updateStage(name: string, status: JobStageStatus, message?: string, attempt?: number): Promise<JobState> {
    const state = await this.read()
    const now = new Date().toISOString()

    if (!state.stages.some((stage) => stage.name === name)) {
      throw new Error(`Job stage not found: ${name}`)
    }

    const stages = state.stages.map((stage) => {
      if (stage.name !== name) {
        return stage
      }

      return {
        ...stage,
        attempt: attempt ?? stage.attempt,
        completedAt: isTerminalJobStageStatus(status) ? now : undefined,
        current: status === JOB_STATUS_RUNNING ? stage.current : undefined,
        message: isMessageJobStageStatus(status) ? message : undefined,
        percent: status === JOB_STATUS_RUNNING ? stage.percent : undefined,
        startedAt: status === JOB_STATUS_RUNNING ? now : stage.startedAt,
        status,
        step: status === JOB_STATUS_RUNNING ? stage.step : undefined,
        total: status === JOB_STATUS_RUNNING ? stage.total : undefined,
        unit: status === JOB_STATUS_RUNNING ? stage.unit : undefined,
      }
    })
    const runStatus = deriveJobRunStatus(stages)
    const updated: JobState = {
      ...state,
      completedAt: isTerminalJobRunStatus(runStatus) ? now : undefined,
      stages,
      status: runStatus,
      updatedAt: now,
    }

    await this.write(updated)

    return updated
  }

  async updateStageProgress(name: string, progress: JobStageProgress): Promise<JobState> {
    const state = await this.read()
    const now = new Date().toISOString()

    if (!state.stages.some((stage) => stage.name === name)) {
      throw new Error(`Job stage not found: ${name}`)
    }

    const normalizedProgress = normalizeJobStageProgress(progress)
    const stages = state.stages.map((stage) => {
      if (stage.name !== name) {
        return stage
      }

      return {
        ...stage,
        current: normalizedProgress.current,
        message: normalizedProgress.message,
        percent: normalizedProgress.percent,
        step: normalizedProgress.step,
        total: normalizedProgress.total,
        unit: normalizedProgress.unit,
      }
    })
    const updated: JobState = {
      ...state,
      stages,
      updatedAt: now,
    }

    await this.write(updated)

    return updated
  }

  private async readOptional(): Promise<JobState | undefined> {
    const value = await readOptionalJobStateJson(this.path)

    if (value === undefined) {
      return undefined
    }

    return parseJobState(value)
  }

  private async write(state: JobState): Promise<void> {
    await mkdir(dirname(this.path), {recursive: true})
    await writeFile(this.path, `${JSON.stringify(state, null, 2)}\n`)
  }
}

async function readRequiredJobStateJson(path: string): Promise<unknown> {
  const value = await readOptionalJobStateJson(path)

  if (value === undefined) {
    throw Object.assign(new Error(`Job state JSON is missing: ${path}`), {code: 'ENOENT'})
  }

  return value
}

async function readOptionalJobStateJson(path: string): Promise<unknown | undefined> {
  let text: string

  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isEnoentError(error)) {
      return undefined
    }

    throw error
  }

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`Job state file ${path} is invalid JSON; no job-state parse fallback is allowed. ${formatErrorMessage(error)}`)
  }
}

function parseJobState(value: unknown): JobState {
  if (!isRecord(value)) {
    throw new Error('Job state must be an object.')
  }

  const pipeline = readRequiredString(value.pipeline, 'pipeline')

  return {
    ...(value.completedAt === undefined ? {} : {completedAt: readRequiredString(value.completedAt, 'completedAt')}),
    createdAt: readRequiredString(value.createdAt, 'createdAt'),
    inputPath: readRequiredString(value.inputPath, 'inputPath'),
    pipeline,
    projectId: readRequiredString(value.projectId, 'projectId'),
    stages: readStages(value.stages),
    status: readJobRunStatus(value.status),
    updatedAt: readRequiredString(value.updatedAt, 'updatedAt'),
    version: readVersion(value.version),
  }
}

function readStages(value: unknown): JobStageState[] {
  if (!Array.isArray(value)) {
    throw new Error('Job state stages must be an array.')
  }

  return value.map((stage, index): JobStageState => {
    if (!isRecord(stage)) {
      throw new Error(`Job state stage ${index + 1} must be an object.`)
    }

    return {
      ...(stage.attempt === undefined ? {} : {attempt: readNumber(stage.attempt, `stages.${index}.attempt`)}),
      ...(stage.completedAt === undefined ? {} : {completedAt: readRequiredString(stage.completedAt, `stages.${index}.completedAt`)}),
      ...(stage.current === undefined ? {} : {current: readNumber(stage.current, `stages.${index}.current`)}),
      ...(stage.message === undefined ? {} : {message: readRequiredString(stage.message, `stages.${index}.message`)}),
      name: readRequiredString(stage.name, `stages.${index}.name`),
      ...(stage.percent === undefined ? {} : {percent: readNumber(stage.percent, `stages.${index}.percent`)}),
      ...(stage.startedAt === undefined ? {} : {startedAt: readRequiredString(stage.startedAt, `stages.${index}.startedAt`)}),
      status: readJobStageStatus(stage.status, `stages.${index}.status`),
      ...(stage.step === undefined ? {} : {step: readRequiredString(stage.step, `stages.${index}.step`)}),
      ...(stage.total === undefined ? {} : {total: readNumber(stage.total, `stages.${index}.total`)}),
      ...(stage.unit === undefined ? {} : {unit: readRequiredString(stage.unit, `stages.${index}.unit`)}),
    }
  })
}

function readVersion(value: unknown): 1 {
  if (value !== 1) {
    throw new Error('Job state version must be 1.')
  }

  return value
}

function readJobRunStatus(value: unknown): JobRunStatus {
  if (!isJobRunStatus(value)) {
    throw new Error(`Job state status must be ${JOB_RUN_STATUSES.join(', ')}.`)
  }

  return value
}

function readJobStageStatus(value: unknown, field: string): JobStageStatus {
  if (!isJobStageStatus(value)) {
    throw new Error(`Job state ${field} has an invalid stage status.`)
  }

  return value
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Job state ${field} must be a non-empty string.`)
  }

  return value
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Job state ${field} must be a finite number.`)
  }

  return value
}

function readProgressNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Job stage progress ${field} must be a finite non-negative number; no progress clamp fallback is allowed. Received: ${String(value)}`)
  }

  return value
}

function readProgressPercent(value: unknown): number {
  const percent = readProgressNumber(value, 'percent')

  if (percent > 100) {
    throw new Error(`Job stage progress percent must be between 0 and 100; no progress clamp fallback is allowed. Received: ${String(percent)}`)
  }

  return percent
}

function readProgressString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Job stage progress ${field} must be a non-empty string; no progress string fallback is allowed.`)
  }

  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEnoentError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
