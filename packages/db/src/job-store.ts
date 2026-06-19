import {mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'

import {bunFile, bunWrite} from './bun-runtime.js'

export type JobRunStatus = 'completed' | 'failed' | 'running'
export type JobStageStatus = 'completed' | 'failed' | 'pending' | 'running'

export interface JobStageState {
  attempt?: number
  completedAt?: string
  message?: string
  name: string
  startedAt?: string
  status: JobStageStatus
}

export interface JobState {
  completedAt?: string
  createdAt: string
  inputPath: string
  pipeline?: string
  projectId: string
  stages: JobStageState[]
  status: JobRunStatus
  updatedAt: string
  version: 1
}

export interface InitializeJobOptions {
  inputPath: string
  pipeline?: string
  projectId: string
  stages: readonly string[]
}

export interface JobStore {
  complete(status: JobRunStatus): Promise<JobState>
  initialize(options: InitializeJobOptions): Promise<JobState>
  read(): Promise<JobState>
  updateStage(name: string, status: JobStageStatus, message?: string, attempt?: number): Promise<JobState>
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
      pipeline: options.pipeline ?? existing?.pipeline,
      projectId: options.projectId,
      stages: options.stages.map((stage) => existing?.stages.find((existingStage) => existingStage.name === stage) ?? {name: stage, status: 'pending'}),
      status: 'running',
      updatedAt: now,
      version: 1,
    }

    await this.write(state)

    return state
  }

  async read(): Promise<JobState> {
    return bunFile(this.path).json<JobState>()
  }

  async updateStage(name: string, status: JobStageStatus, message?: string, attempt?: number): Promise<JobState> {
    const state = await this.read()
    const now = new Date().toISOString()
    const stages = state.stages.map((stage) => {
      if (stage.name !== name) {
        return stage
      }

      return {
        ...stage,
        attempt: attempt ?? stage.attempt,
        completedAt: status === 'completed' || status === 'failed' ? now : undefined,
        message: status === 'failed' ? message : undefined,
        startedAt: status === 'running' ? now : stage.startedAt,
        status,
      }
    })
    const runStatus = stages.some((stage) => stage.status === 'failed') ? 'failed' : stages.every((stage) => stage.status === 'completed') ? 'completed' : 'running'
    const updated: JobState = {
      ...state,
      completedAt: runStatus === 'completed' || runStatus === 'failed' ? now : undefined,
      stages,
      status: runStatus,
      updatedAt: now,
    }

    await this.write(updated)

    return updated
  }

  private async readOptional(): Promise<JobState | undefined> {
    if (!await bunFile(this.path).exists()) {
      return undefined
    }

    return this.read()
  }

  private async write(state: JobState): Promise<void> {
    await mkdir(dirname(this.path), {recursive: true})
    await bunWrite(this.path, `${JSON.stringify(state, null, 2)}\n`)
  }
}
