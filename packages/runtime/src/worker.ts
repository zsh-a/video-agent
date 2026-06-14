import type {JobRunStatus, JobStageState} from '@video-agent/db'

import type {InitialPipelineStage, RunInitialPipelineResult} from './job-runner.js'

import {readProjectStatus} from './project-status.js'
import {listProjects} from './projects.js'
import {rerunProject} from './rerun.js'

export interface RecoverWorkspaceJobsOptions {
  dryRun?: boolean
  limit?: number
  maxAttempts?: number
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
  error?: string
  fromStage?: InitialPipelineStage
  jobStatus?: JobRunStatus
  projectId: string
  result?: RunInitialPipelineResult
  skipReason?: 'attempt-limit' | 'limit' | 'not-recoverable'
  status: 'failed' | 'recovered' | 'skipped' | 'would-recover'
}

export type RecoverableJobStatus = 'failed' | 'running'

type RecoveryCandidate = RecoverWorkspaceJobResult & {
  fromStage: InitialPipelineStage
  jobStatus: JobRunStatus
  status: 'would-recover'
}

const RECOVERABLE_STATUSES: readonly RecoverableJobStatus[] = ['failed', 'running']
const STAGE_VALUES = new Set<InitialPipelineStage>(['ingest', 'plan', 'quality', 'script', 'understand', 'voiceover'])

export async function recoverWorkspaceJobs(options: RecoverWorkspaceJobsOptions = {}): Promise<RecoverWorkspaceJobsReport> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const statuses = options.statuses ?? RECOVERABLE_STATUSES
  const projects = await listProjects(workspaceDir)
  const inspected = await Promise.all(projects.map(async (project) => readRecoveryCandidate(project.projectId, workspaceDir, statuses, options.maxAttempts)))
  const selected = selectRecoveryCandidates(inspected, options.limit)
  const deferred = selectDeferredCandidates(inspected, options.limit)
  const recovered = options.dryRun === true ? [] : await Promise.all(selected.map((candidate) => recoverProject({
    attempt: candidate.attempt,
    fromStage: candidate.fromStage,
    jobStatus: candidate.jobStatus,
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

async function readRecoveryCandidate(projectId: string, workspaceDir: string, statuses: readonly RecoverableJobStatus[], maxAttempts: number | undefined): Promise<RecoverWorkspaceJobResult> {
  const status = await readProjectStatus(projectId, workspaceDir)
  const jobStatus = status.job.status
  const stage = statuses.includes(jobStatus as RecoverableJobStatus) ? findRecoveryStage(status.job.stages) : undefined

  if (stage === undefined) {
    return {
      jobStatus,
      projectId,
      skipReason: 'not-recoverable',
      status: 'skipped',
    }
  }

  if (maxAttempts !== undefined && (stage.attempt ?? 0) >= maxAttempts) {
    return {
      attempt: stage.attempt,
      fromStage: stage.name,
      jobStatus,
      projectId,
      skipReason: 'attempt-limit',
      status: 'skipped',
    }
  }

  return {
    attempt: stage.attempt,
    fromStage: stage.name,
    jobStatus,
    projectId,
    status: 'would-recover',
  }
}

function selectRecoveryCandidates(results: RecoverWorkspaceJobResult[], limit: number | undefined): RecoveryCandidate[] {
  const candidates = results.filter((result): result is RecoveryCandidate => result.status === 'would-recover' && result.fromStage !== undefined && result.jobStatus !== undefined)

  return limit === undefined ? candidates : candidates.slice(0, limit)
}

function selectDeferredCandidates(results: RecoverWorkspaceJobResult[], limit: number | undefined): RecoverWorkspaceJobResult[] {
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
      projectId: candidate.projectId,
      skipReason: 'limit',
      status: 'skipped',
    }))
}

type RecoverableStage = JobStageState & {
  name: InitialPipelineStage
}

function findRecoveryStage(stages: JobStageState[]): RecoverableStage | undefined {
  const stage = stages.find((item) => item.status === 'failed') ?? stages.find((item) => item.status === 'running') ?? stages.find((item) => item.status === 'pending')

  return isInitialPipelineStage(stage?.name) ? {...stage, name: stage.name} : undefined
}

interface RecoverProjectOptions {
  attempt?: number
  fromStage: InitialPipelineStage
  jobStatus: JobRunStatus
  projectId: string
  workspaceDir: string
}

async function recoverProject(options: RecoverProjectOptions): Promise<RecoverWorkspaceJobResult> {
  try {
    return {
      attempt: options.attempt,
      fromStage: options.fromStage,
      jobStatus: options.jobStatus,
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
      projectId: options.projectId,
      status: 'failed',
    }
  }
}

function isInitialPipelineStage(value: string | undefined): value is InitialPipelineStage {
  return value !== undefined && STAGE_VALUES.has(value as InitialPipelineStage)
}
