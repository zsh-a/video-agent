import {mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'

import {JOB_STATUS_PENDING, JOB_STATUS_RUNNING, deriveJobRunStatus, isMessageJobStageStatus, isTerminalJobRunStatus, isTerminalJobStageStatus, normalizeJobStageProgress, type InitializeJobOptions, type JobRunStatus, type JobStageProgress, type JobStageState, type JobStageStatus, type JobState, type JobStore} from './job-store.js'

interface BunDatabase {
  exec(sql: string): void
  prepare<T = unknown>(sql: string): BunStatement<T>
}

interface BunStatement<T = unknown> {
  all(...params: unknown[]): T[]
  get(...params: unknown[]): null | T
  run(...params: unknown[]): unknown
}

interface JobRow {
  completed_at: null | string
  created_at: string
  input_path: string
  pipeline: string
  project_id: string
  status: JobRunStatus
  updated_at: string
  version: 1
}

interface StageRow {
  attempt: null | number
  completed_at: null | string
  current: null | number
  message: null | string
  name: string
  percent: null | number
  position: number
  started_at: null | string
  status: JobStageStatus
  step: null | string
  total: null | number
  unit: null | string
}

export class BunSqliteJobStore implements JobStore {
  private db: BunDatabase | undefined

  constructor(
    private readonly path: string,
    private readonly projectId: string,
  ) {}

  async complete(status: JobRunStatus): Promise<JobState> {
    const database = await this.open()
    const now = new Date().toISOString()

    database
      .prepare(
        `
          update jobs
          set completed_at = ?, status = ?, updated_at = ?
          where project_id = ?
        `,
      )
      .run(now, status, now, this.projectId)

    return this.read()
  }

  async initialize(options: InitializeJobOptions): Promise<JobState> {
    const database = await this.open()
    const existing = await this.readOptional()
    const now = new Date().toISOString()
    const createdAt = existing?.createdAt ?? now

    database
      .prepare(
        `
          insert into jobs (project_id, input_path, pipeline, status, created_at, updated_at, version)
          values (?, ?, ?, ?, ?, ?, 1)
          on conflict(project_id) do update set
            input_path = excluded.input_path,
            pipeline = excluded.pipeline,
            status = excluded.status,
            updated_at = excluded.updated_at
        `,
      )
      .run(options.projectId, options.inputPath, options.pipeline, JOB_STATUS_RUNNING, createdAt, now)

    database.prepare('delete from job_stages where project_id = ?').run(options.projectId)

    const insertStage = database.prepare(
      `
        insert into job_stages (project_id, name, status, attempt, started_at, completed_at, message, step, current, total, percent, unit, position)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )

    for (const [index, stage] of options.stages.entries()) {
      const existingStage = existing?.stages.find((item) => item.name === stage)

      insertStage.run(
        options.projectId,
        stage,
        existingStage?.status ?? JOB_STATUS_PENDING,
        existingStage?.attempt ?? null,
        existingStage?.startedAt ?? null,
        existingStage?.completedAt ?? null,
        existingStage?.message ?? null,
        existingStage?.step ?? null,
        existingStage?.current ?? null,
        existingStage?.total ?? null,
        existingStage?.percent ?? null,
        existingStage?.unit ?? null,
        index,
      )
    }

    return this.read()
  }

  async read(): Promise<JobState> {
    const database = await this.open()
    const job = database
      .prepare<JobRow>(
        `
          select completed_at, created_at, input_path, pipeline, project_id, status, updated_at, version
          from jobs
          where project_id = ?
        `,
      )
      .get(this.projectId)

    if (job === null) {
      throw new Error(`Job state not found for project: ${this.projectId}`)
    }

    if (typeof job.pipeline !== 'string' || job.pipeline.length === 0) {
      throw new Error(`Job state for project ${this.projectId} is missing pipeline.`)
    }

    const stages = database
      .prepare<StageRow>(
        `
          select attempt, completed_at, current, message, name, percent, position, started_at, status, step, total, unit
          from job_stages
          where project_id = ?
          order by position asc
        `,
      )
      .all(this.projectId)

    return {
      ...(job.completed_at === null ? {} : {completedAt: job.completed_at}),
      createdAt: job.created_at,
      inputPath: job.input_path,
      pipeline: job.pipeline,
      projectId: job.project_id,
      stages: stages.map((stage) => deserializeStage(stage)),
      status: job.status,
      updatedAt: job.updated_at,
      version: job.version,
    }
  }

  async updateStage(name: string, status: JobStageStatus, message?: string, attempt?: number): Promise<JobState> {
    const database = await this.open()
    const now = new Date().toISOString()
    const existing = database
      .prepare<StageRow>(
        `
          select attempt, completed_at, current, message, name, percent, position, started_at, status, step, total, unit
          from job_stages
          where project_id = ? and name = ?
        `,
      )
      .get(this.projectId, name)

    if (existing === null) {
      throw new Error(`Job stage not found: ${name}`)
    }

    database
      .prepare(
        `
          update job_stages
          set attempt = ?, completed_at = ?, current = ?, message = ?, percent = ?, started_at = ?, status = ?, step = ?, total = ?, unit = ?
          where project_id = ? and name = ?
        `,
      )
      .run(
        attempt ?? existing.attempt,
        isTerminalJobStageStatus(status) ? now : null,
        status === JOB_STATUS_RUNNING ? existing.current : null,
        isMessageJobStageStatus(status) ? message ?? null : null,
        status === JOB_STATUS_RUNNING ? existing.percent : null,
        status === JOB_STATUS_RUNNING ? now : existing.started_at,
        status,
        status === JOB_STATUS_RUNNING ? existing.step : null,
        status === JOB_STATUS_RUNNING ? existing.total : null,
        status === JOB_STATUS_RUNNING ? existing.unit : null,
        this.projectId,
        name,
      )

    const stageStatuses = database
      .prepare<{status: JobStageStatus}>(
        `
          select status
          from job_stages
          where project_id = ?
        `,
      )
      .all(this.projectId)
    const runStatus = deriveJobRunStatus(stageStatuses)

    database
      .prepare(
        `
          update jobs
          set completed_at = ?, status = ?, updated_at = ?
          where project_id = ?
        `,
      )
      .run(
        isTerminalJobRunStatus(runStatus) ? now : null,
        runStatus,
        now,
        this.projectId,
      )

    return this.read()
  }

  async updateStageProgress(name: string, progress: JobStageProgress): Promise<JobState> {
    const database = await this.open()
    const now = new Date().toISOString()
    const existing = database
      .prepare<Pick<StageRow, 'name'>>(
        `
          select name
          from job_stages
          where project_id = ? and name = ?
        `,
      )
      .get(this.projectId, name)

    if (existing === null) {
      throw new Error(`Job stage not found: ${name}`)
    }

    const normalizedProgress = normalizeJobStageProgress(progress)

    database
      .prepare(
        `
          update job_stages
          set current = ?, message = ?, percent = ?, step = ?, total = ?, unit = ?
          where project_id = ? and name = ?
        `,
      )
      .run(
        normalizedProgress.current ?? null,
        normalizedProgress.message ?? null,
        normalizedProgress.percent ?? null,
        normalizedProgress.step ?? null,
        normalizedProgress.total ?? null,
        normalizedProgress.unit ?? null,
        this.projectId,
        name,
      )

    database
      .prepare(
        `
          update jobs
          set updated_at = ?
          where project_id = ?
        `,
      )
      .run(now, this.projectId)

    return this.read()
  }

  private async open(): Promise<BunDatabase> {
    if (this.db !== undefined) {
      return this.db
    }

    await mkdir(dirname(this.path), {recursive: true})

    const sqliteModule = 'bun:sqlite'
    const sqlite = (await import(sqliteModule)) as {Database: new (path: string, options?: {create?: boolean}) => BunDatabase}
    const database = new sqlite.Database(this.path, {create: true})

    database.exec(`
      create table if not exists jobs (
        project_id text primary key,
        input_path text not null,
        pipeline text not null,
        status text not null,
        completed_at text,
        created_at text not null,
        updated_at text not null,
        version integer not null
      );

      create table if not exists job_stages (
        project_id text not null,
        name text not null,
        status text not null,
        attempt integer,
        started_at text,
        completed_at text,
        current real,
        message text,
        percent real,
        position integer not null,
        step text,
        total real,
        unit text,
        primary key (project_id, name),
        foreign key (project_id) references jobs(project_id) on delete cascade
      );

      create index if not exists job_stages_project_position_idx
      on job_stages(project_id, position);
    `)
    addColumnIfMissing(database, 'jobs', 'pipeline text')
    addColumnIfMissing(database, 'job_stages', 'attempt integer')
    addColumnIfMissing(database, 'job_stages', 'current real')
    addColumnIfMissing(database, 'job_stages', 'percent real')
    addColumnIfMissing(database, 'job_stages', 'step text')
    addColumnIfMissing(database, 'job_stages', 'total real')
    addColumnIfMissing(database, 'job_stages', 'unit text')

    this.db = database

    return database
  }

  private async readOptional(): Promise<JobState | undefined> {
    try {
      return await this.read()
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Job state not found for project:')) {
        return undefined
      }

      throw error
    }
  }
}

function deserializeStage(stage: StageRow): JobStageState {
  return {
    ...(stage.attempt === null ? {} : {attempt: stage.attempt}),
    ...(stage.completed_at === null ? {} : {completedAt: stage.completed_at}),
    ...(stage.current === null ? {} : {current: stage.current}),
    ...(stage.message === null ? {} : {message: stage.message}),
    name: stage.name,
    ...(stage.percent === null ? {} : {percent: stage.percent}),
    ...(stage.started_at === null ? {} : {startedAt: stage.started_at}),
    status: stage.status,
    ...(stage.step === null ? {} : {step: stage.step}),
    ...(stage.total === null ? {} : {total: stage.total}),
    ...(stage.unit === null ? {} : {unit: stage.unit}),
  }
}

function addColumnIfMissing(database: BunDatabase, table: string, columnDefinition: string): void {
  try {
    database.exec(`alter table ${table} add column ${columnDefinition}`)
  } catch (error) {
    if (error instanceof Error && error.message.includes('duplicate column name')) {
      return
    }

    throw error
  }
}
