import type {JobRunStatus, JobStageState} from '@video-agent/db'

import type {InitialPipelineStage, RunInitialPipelineResult} from './job-runner.js'

import {readProjectStatus} from './project-status.js'
import {listProjects} from './projects.js'
import {rerunProject} from './rerun.js'

export interface RecoverWorkspaceJobsOptions {
  dryRun?: boolean
  limit?: number
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
  error?: string
  fromStage?: InitialPipelineStage
  jobStatus?: JobRunStatus
  projectId: string
  result?: RunInitialPipelineResult
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
  const inspected = await Promise.all(projects.map(async (project) => readRecoveryCandidate(project.projectId, workspaceDir, statuses)))
  const candidates = selectRecoveryCandidates(inspected, options.limit)
  const recovered = options.dryRun === true ? [] : await Promise.all(candidates.map((candidate) => recoverProject(candidate.projectId, candidate.fromStage, workspaceDir, candidate.jobStatus)))
  const results = options.dryRun === true ? candidates.map((candidate) => candidate) : [...inspected.filter((result) => result.status === 'skipped'), ...recovered]

  return {
    dryRun: options.dryRun === true,
    recovered: results.filter((result) => result.status === 'recovered').length,
    results,
    skipped: results.filter((result) => result.status === 'skipped').length,
    workspaceDir,
  }
}

async function readRecoveryCandidate(projectId: string, workspaceDir: string, statuses: readonly RecoverableJobStatus[]): Promise<RecoverWorkspaceJobResult> {
  const status = await readProjectStatus(projectId, workspaceDir)
  const jobStatus = status.job.status
  const fromStage = statuses.includes(jobStatus as RecoverableJobStatus) ? findRecoveryStage(status.job.stages) : undefined

  if (fromStage === undefined) {
    return {
      jobStatus,
      projectId,
      status: 'skipped',
    }
  }

  return {
    fromStage,
    jobStatus,
    projectId,
    status: 'would-recover',
  }
}

function selectRecoveryCandidates(results: RecoverWorkspaceJobResult[], limit: number | undefined): RecoveryCandidate[] {
  const candidates = results.filter((result): result is RecoveryCandidate => result.status === 'would-recover' && result.fromStage !== undefined && result.jobStatus !== undefined)

  return limit === undefined ? candidates : candidates.slice(0, limit)
}

function findRecoveryStage(stages: JobStageState[]): InitialPipelineStage | undefined {
  const stage = stages.find((item) => item.status === 'failed') ?? stages.find((item) => item.status === 'running') ?? stages.find((item) => item.status === 'pending')

  return isInitialPipelineStage(stage?.name) ? stage.name : undefined
}

async function recoverProject(projectId: string, fromStage: InitialPipelineStage, workspaceDir: string, jobStatus: JobRunStatus): Promise<RecoverWorkspaceJobResult> {
  try {
    return {
      fromStage,
      jobStatus,
      projectId,
      result: await rerunProject(projectId, {
        fromStage,
        workspaceDir,
      }),
      status: 'recovered',
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      fromStage,
      jobStatus,
      projectId,
      status: 'failed',
    }
  }
}

function isInitialPipelineStage(value: string | undefined): value is InitialPipelineStage {
  return value !== undefined && STAGE_VALUES.has(value as InitialPipelineStage)
}
