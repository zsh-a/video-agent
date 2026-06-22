import type {JobRunStatus, JobStageState} from '@video-agent/db'

import {JOB_STATUS_FAILED, JOB_STATUS_PENDING, JOB_STATUS_RUNNING} from '@video-agent/db'
import {ZodError} from 'zod'

import type {RerunFilmProjectResult} from './rerun.js'
import {FILM_PIPELINE_DEFINITION, type FilmPipelineStage} from './pipeline.js'
import {PIPELINE_KIND_FILM, detectPipelineKind, isPipelineStage, type PipelineKind} from '@video-agent/core'
import {assertPipelineCheckpointArtifacts, listProjects, PipelineCheckpointError, readProjectStatus, DEFAULT_WORKSPACE_DIR} from '@video-agent/runtime'
import {rerunFilmProject} from './rerun.js'

export interface RecoverFilmWorkspaceJobsOptions {
  dryRun?: boolean
  limit?: number
  maxAttempts?: number
  orderBy?: FilmRecoveryOrderBy
  runningStaleAfterMs?: number
  statuses?: readonly FilmRecoverableJobStatus[]
  workspaceDir?: string
}

export interface RecoverFilmWorkspaceJobsReport {
  dryRun: boolean
  recovered: number
  results: RecoverFilmWorkspaceJobResult[]
  skipped: number
  workspaceDir: string
}

export interface RecoverFilmWorkspaceJobResult {
  attempt?: number
  changedArtifacts?: string[]
  error?: string
  fromStage?: FilmPipelineStage
  jobStatus?: JobRunStatus
  missingArtifacts?: string[]
  pipeline: PipelineKind
  projectId: string
  result?: RerunFilmProjectResult
  schemaInvalidArtifacts?: string[]
  skipReason?: 'attempt-limit' | 'checkpoint-invalid' | 'limit' | 'not-recoverable' | 'running-active'
  status: 'failed' | 'recovered' | 'skipped' | 'would-recover'
  untrackedArtifacts?: string[]
  updatedAt?: string
  validationIssues?: CheckpointValidationIssue[]
}

export const FILM_RECOVERABLE_JOB_STATUSES = [JOB_STATUS_FAILED, JOB_STATUS_RUNNING] as const
export const FILM_RECOVERY_STATUS_OPTIONS = ['active', ...FILM_RECOVERABLE_JOB_STATUSES] as const
export const FILM_RECOVERY_ORDER_BY_VALUES = ['attempt', 'oldest', 'recent'] as const

export type FilmRecoverableJobStatus = (typeof FILM_RECOVERABLE_JOB_STATUSES)[number]
export type FilmRecoveryStatusOption = (typeof FILM_RECOVERY_STATUS_OPTIONS)[number]
export type FilmRecoveryOrderBy = (typeof FILM_RECOVERY_ORDER_BY_VALUES)[number]

type RecoveryCandidate = RecoverFilmWorkspaceJobResult & {
  fromStage: FilmPipelineStage
  jobStatus: JobRunStatus
  pipeline: typeof PIPELINE_KIND_FILM
  status: 'would-recover'
}

export async function recoverFilmWorkspaceJobs(options: RecoverFilmWorkspaceJobsOptions = {}): Promise<RecoverFilmWorkspaceJobsReport> {
  const workspaceDir = options.workspaceDir ?? DEFAULT_WORKSPACE_DIR
  const statuses = options.statuses ?? FILM_RECOVERABLE_JOB_STATUSES
  const projects = await listProjects(workspaceDir)
  const inspected = await Promise.all(projects.map(async (project) => readRecoveryCandidate(project.projectId, workspaceDir, {
    maxAttempts: options.maxAttempts,
    runningStaleAfterMs: options.runningStaleAfterMs,
    statuses,
  })))
  const candidates = sortRecoveryCandidates(inspected, options.orderBy)
  const selected = selectRecoveryCandidates(candidates, options.limit)
  const deferred = selectDeferredCandidates(candidates, options.limit)
  const recovered = options.dryRun === true ? [] : await Promise.all(selected.map((candidate) => recoverProject({
    attempt: candidate.attempt,
    fromStage: candidate.fromStage,
    jobStatus: candidate.jobStatus,
    pipeline: candidate.pipeline,
    projectId: candidate.projectId,
    workspaceDir,
  })))
  const skipped = [...inspected.filter((result) => result.status === 'skipped'), ...deferred]
  const results = options.dryRun === true ? [...selected, ...skipped] : [...skipped, ...recovered]

  return {
    dryRun: options.dryRun === true,
    recovered: results.filter((result) => result.status === 'recovered').length,
    results,
    skipped: results.filter((result) => result.status === 'skipped').length,
    workspaceDir,
  }
}

export function resolveFilmRecoverableStatuses(status: null | FilmRecoveryStatusOption | undefined): readonly FilmRecoverableJobStatus[] | undefined {
  if (status === undefined || status === null || status === 'active') {
    return undefined
  }

  if (isFilmRecoverableJobStatus(status)) {
    return [status]
  }

  throw new Error(`Invalid recoverable job status: ${status}`)
}

export function isFilmRecoverableJobStatus(status: string): status is FilmRecoverableJobStatus {
  return (FILM_RECOVERABLE_JOB_STATUSES as readonly string[]).includes(status)
}

export function isFilmRecoveryOrderBy(value: string): value is FilmRecoveryOrderBy {
  return (FILM_RECOVERY_ORDER_BY_VALUES as readonly string[]).includes(value)
}

interface ReadRecoveryCandidateOptions {
  maxAttempts?: number
  runningStaleAfterMs?: number
  statuses: readonly FilmRecoverableJobStatus[]
}

async function readRecoveryCandidate(projectId: string, workspaceDir: string, options: ReadRecoveryCandidateOptions): Promise<RecoverFilmWorkspaceJobResult> {
  const status = await readProjectStatus(projectId, workspaceDir)
  const {status: jobStatus, updatedAt} = status.job
  const pipeline = detectPipelineKind(status.job)

  if (pipeline !== PIPELINE_KIND_FILM) {
    return {
      jobStatus,
      pipeline,
      projectId,
      skipReason: 'not-recoverable',
      status: 'skipped',
      updatedAt,
    }
  }

  const stage = isFilmRecoverableJobStatus(jobStatus) && options.statuses.includes(jobStatus) ? findRecoveryStage(status.job.stages) : undefined

  if (stage === undefined) {
    return {
      jobStatus,
      pipeline,
      projectId,
      skipReason: 'not-recoverable',
      status: 'skipped',
      updatedAt,
    }
  }

  if (jobStatus === JOB_STATUS_RUNNING && isRunningJobActive(updatedAt, options.runningStaleAfterMs)) {
    return {
      attempt: stage.attempt,
      fromStage: stage.name,
      jobStatus,
      pipeline,
      projectId,
      skipReason: 'running-active',
      status: 'skipped',
      updatedAt,
    }
  }

  if (options.maxAttempts !== undefined && (stage.attempt ?? 0) >= options.maxAttempts) {
    return {
      attempt: stage.attempt,
      fromStage: stage.name,
      jobStatus,
      pipeline,
      projectId,
      skipReason: 'attempt-limit',
      status: 'skipped',
      updatedAt,
    }
  }

  const checkpointIssue = await readCheckpointIssue(projectId, workspaceDir, stage.name)

  if (checkpointIssue !== undefined) {
    return {
      attempt: stage.attempt,
      changedArtifacts: checkpointIssue.changedArtifacts,
      error: checkpointIssue.message,
      fromStage: stage.name,
      jobStatus,
      pipeline,
      missingArtifacts: checkpointIssue.missingArtifacts,
      projectId,
      schemaInvalidArtifacts: checkpointIssue.schemaInvalidArtifacts,
      skipReason: 'checkpoint-invalid',
      status: 'skipped',
      untrackedArtifacts: checkpointIssue.untrackedArtifacts,
      updatedAt,
      validationIssues: checkpointIssue.validationIssues,
    }
  }

  return {
    attempt: stage.attempt,
    fromStage: stage.name,
    jobStatus,
    pipeline,
    projectId,
    status: 'would-recover',
    updatedAt,
  }
}

function sortRecoveryCandidates(results: RecoverFilmWorkspaceJobResult[], orderBy: FilmRecoveryOrderBy | undefined): RecoverFilmWorkspaceJobResult[] {
  const sorted = [...results]

  if (orderBy === 'oldest') {
    return sorted.sort((left, right) => compareUpdatedAt(left.updatedAt, right.updatedAt))
  }

  if (orderBy === 'attempt') {
    return sorted.sort((left, right) => (right.attempt ?? 0) - (left.attempt ?? 0) || compareUpdatedAt(left.updatedAt, right.updatedAt))
  }

  if (orderBy === 'recent') {
    return sorted.sort((left, right) => compareUpdatedAt(right.updatedAt, left.updatedAt))
  }

  return sorted
}

function selectRecoveryCandidates(results: RecoverFilmWorkspaceJobResult[], limit: number | undefined): RecoveryCandidate[] {
  const candidates = results.filter((result): result is RecoveryCandidate => result.status === 'would-recover' && result.fromStage !== undefined && result.jobStatus !== undefined)

  return limit === undefined ? candidates : candidates.slice(0, limit)
}

function selectDeferredCandidates(results: RecoverFilmWorkspaceJobResult[], limit: number | undefined): RecoverFilmWorkspaceJobResult[] {
  if (limit === undefined) {
    return []
  }

  return results
    .filter((result): result is RecoveryCandidate => result.status === 'would-recover' && result.fromStage !== undefined && result.jobStatus !== undefined)
    .slice(limit)
    .map((candidate) => ({
      attempt: candidate.attempt,
      fromStage: candidate.fromStage,
      jobStatus: candidate.jobStatus,
      pipeline: candidate.pipeline,
      projectId: candidate.projectId,
      skipReason: 'limit',
      status: 'skipped',
      updatedAt: candidate.updatedAt,
    }))
}

type RecoverableStage = JobStageState & {
  name: FilmPipelineStage
}

function findRecoveryStage(stages: JobStageState[]): RecoverableStage | undefined {
  const stage = stages.find((item) => item.status === JOB_STATUS_FAILED)
    ?? stages.find((item) => item.status === JOB_STATUS_RUNNING)
    ?? stages.find((item) => item.status === JOB_STATUS_PENDING)

  return isPipelineStage(FILM_PIPELINE_DEFINITION, stage?.name) ? {...stage, name: stage.name} : undefined
}

interface RecoverProjectOptions {
  attempt?: number
  fromStage: FilmPipelineStage
  jobStatus: JobRunStatus
  pipeline: typeof PIPELINE_KIND_FILM
  projectId: string
  workspaceDir: string
}

async function recoverProject(options: RecoverProjectOptions): Promise<RecoverFilmWorkspaceJobResult> {
  try {
    return {
      attempt: options.attempt,
      fromStage: options.fromStage,
      jobStatus: options.jobStatus,
      pipeline: options.pipeline,
      projectId: options.projectId,
      result: await rerunFilmProject(options.projectId, {
        fromStage: options.fromStage,
        workspaceDir: options.workspaceDir,
      }),
      status: 'recovered',
    }
  } catch (error) {
    return {
      attempt: options.attempt,
      error: error instanceof Error ? error.message : String(error),
      fromStage: options.fromStage,
      jobStatus: options.jobStatus,
      pipeline: options.pipeline,
      projectId: options.projectId,
      status: 'failed',
    }
  }
}

interface CheckpointIssue {
  changedArtifacts: string[]
  message: string
  missingArtifacts: string[]
  schemaInvalidArtifacts: string[]
  untrackedArtifacts: string[]
  validationIssues?: CheckpointValidationIssue[]
}

export interface CheckpointValidationIssue {
  code: string
  message: string
  path: string[]
}

async function readCheckpointIssue(projectId: string, workspaceDir: string, fromStage: FilmPipelineStage): Promise<CheckpointIssue | undefined> {
  try {
    await assertPipelineCheckpointArtifacts(projectId, workspaceDir, FILM_PIPELINE_DEFINITION, fromStage)
    return undefined
  } catch (error) {
    if (error instanceof PipelineCheckpointError) {
      return {
        changedArtifacts: error.changedArtifacts,
        message: error.message,
        missingArtifacts: error.missingArtifacts,
        schemaInvalidArtifacts: error.schemaInvalidArtifacts,
        untrackedArtifacts: error.untrackedArtifacts,
      }
    }

    if (error instanceof ZodError) {
      return {
        changedArtifacts: [],
        message: 'Checkpoint IR validation failed.',
        missingArtifacts: [],
        schemaInvalidArtifacts: [],
        untrackedArtifacts: [],
        validationIssues: error.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: issue.path.map(String),
        })),
      }
    }

    throw error
  }
}

function isRunningJobActive(updatedAt: string | undefined, runningStaleAfterMs: number | undefined): boolean {
  if (runningStaleAfterMs === undefined) {
    return false
  }

  const updatedAtMs = updatedAt === undefined ? Number.NaN : Date.parse(updatedAt)

  if (!Number.isFinite(updatedAtMs)) {
    return false
  }

  return Date.now() - updatedAtMs < runningStaleAfterMs
}

function compareUpdatedAt(left: string | undefined, right: string | undefined): number {
  return timestampOrZero(left) - timestampOrZero(right)
}

function timestampOrZero(value: string | undefined): number {
  const timestamp = value === undefined ? Number.NaN : Date.parse(value)

  return Number.isFinite(timestamp) ? timestamp : 0
}
