import type {JobRunStatus, JobStageState} from '@video-agent/db'

import {ZodError} from 'zod'

import type {RerunProjectResult} from './rerun.js'
import {FILM_PIPELINE_DEFINITION} from './pipeline.js'
import {assertPipelineCheckpointArtifacts, detectPipelineKind, isPipelineStage, listProjects, PipelineCheckpointError, readProjectStatus, type PipelineKind, type PipelineStage} from '@video-agent/runtime'
import {rerunProject} from './rerun.js'

export interface RecoverWorkspaceJobsOptions {
  dryRun?: boolean
  limit?: number
  maxAttempts?: number
  orderBy?: RecoveryOrderBy
  runningStaleAfterMs?: number
  statuses?: RecoverableJobStatus[]
  workspaceDir?: string
}

export interface RecoverWorkspaceJobsReport {
  dryRun: boolean
  recovered: number
  results: RecoverWorkspaceJobResult[]
  skipped: number
  workspaceDir: string
}

export interface RecoverWorkspaceJobResult {
  attempt?: number
  changedArtifacts?: string[]
  error?: string
  fromStage?: PipelineStage
  jobStatus?: JobRunStatus
  missingArtifacts?: string[]
  pipeline?: PipelineKind
  projectId: string
  result?: RerunProjectResult
  schemaInvalidArtifacts?: string[]
  skipReason?: 'attempt-limit' | 'checkpoint-invalid' | 'limit' | 'not-recoverable' | 'running-active'
  status: 'failed' | 'recovered' | 'skipped' | 'would-recover'
  untrackedArtifacts?: string[]
  updatedAt?: string
  validationIssues?: CheckpointValidationIssue[]
}

export type RecoverableJobStatus = 'failed' | 'running'
export type RecoveryOrderBy = 'attempt' | 'oldest' | 'recent'

type RecoveryCandidate = RecoverWorkspaceJobResult & {
  fromStage: PipelineStage
  jobStatus: JobRunStatus
  pipeline: PipelineKind
  status: 'would-recover'
}

const RECOVERABLE_STATUSES: readonly RecoverableJobStatus[] = ['failed', 'running']

export async function recoverWorkspaceJobs(options: RecoverWorkspaceJobsOptions = {}): Promise<RecoverWorkspaceJobsReport> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const statuses = options.statuses ?? RECOVERABLE_STATUSES
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

interface ReadRecoveryCandidateOptions {
  maxAttempts?: number
  runningStaleAfterMs?: number
  statuses: readonly RecoverableJobStatus[]
}

async function readRecoveryCandidate(projectId: string, workspaceDir: string, options: ReadRecoveryCandidateOptions): Promise<RecoverWorkspaceJobResult> {
  const status = await readProjectStatus(projectId, workspaceDir)
  const {status: jobStatus, updatedAt} = status.job
  const pipeline = detectRecoverablePipeline(status.job)

  if (pipeline === undefined || pipeline !== 'film') {
    return {
      jobStatus,
      ...(pipeline === undefined ? {} : {pipeline}),
      projectId,
      skipReason: 'not-recoverable',
      status: 'skipped',
      updatedAt,
    }
  }

  const stage = options.statuses.includes(jobStatus as RecoverableJobStatus) ? findRecoveryStage(status.job.stages, pipeline) : undefined

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

  if (jobStatus === 'running' && isRunningJobActive(updatedAt, options.runningStaleAfterMs)) {
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

  const checkpointIssue = await readCheckpointIssue(projectId, workspaceDir, pipeline, stage.name)

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

function detectRecoverablePipeline(job: {pipeline?: string}): PipelineKind | undefined {
  try {
    return detectPipelineKind(job)
  } catch {
    return undefined
  }
}

function sortRecoveryCandidates(results: RecoverWorkspaceJobResult[], orderBy: RecoveryOrderBy | undefined): RecoverWorkspaceJobResult[] {
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

function selectRecoveryCandidates(results: RecoverWorkspaceJobResult[], limit: number | undefined): RecoveryCandidate[] {
  const candidates = results.filter((result): result is RecoveryCandidate => result.status === 'would-recover' && result.fromStage !== undefined && result.jobStatus !== undefined && result.pipeline !== undefined)

  return limit === undefined ? candidates : candidates.slice(0, limit)
}

function selectDeferredCandidates(results: RecoverWorkspaceJobResult[], limit: number | undefined): RecoverWorkspaceJobResult[] {
  if (limit === undefined) {
    return []
  }

  return results
    .filter((result): result is RecoveryCandidate => result.status === 'would-recover' && result.fromStage !== undefined && result.jobStatus !== undefined && result.pipeline !== undefined)
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
  name: PipelineStage
}

function findRecoveryStage(stages: JobStageState[], pipeline: PipelineKind): RecoverableStage | undefined {
  const stage = stages.find((item) => item.status === 'failed') ?? stages.find((item) => item.status === 'running') ?? stages.find((item) => item.status === 'pending')

  if (pipeline !== 'film') {
    return undefined
  }

  return isPipelineStage(FILM_PIPELINE_DEFINITION, stage?.name) ? {...stage, name: stage.name} : undefined
}

interface RecoverProjectOptions {
  attempt?: number
  fromStage: PipelineStage
  jobStatus: JobRunStatus
  pipeline: PipelineKind
  projectId: string
  workspaceDir: string
}

async function recoverProject(options: RecoverProjectOptions): Promise<RecoverWorkspaceJobResult> {
  try {
    return {
      attempt: options.attempt,
      fromStage: options.fromStage,
      jobStatus: options.jobStatus,
      pipeline: options.pipeline,
      projectId: options.projectId,
      result: await rerunProject(options.projectId, {
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

async function readCheckpointIssue(projectId: string, workspaceDir: string, pipeline: PipelineKind, fromStage: PipelineStage): Promise<CheckpointIssue | undefined> {
  if (pipeline !== 'film') {
    return undefined
  }

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
