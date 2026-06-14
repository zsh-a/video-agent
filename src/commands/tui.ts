import type {InitialPipelineStage, ProjectArtifact, ProjectEventRecord, ProjectStatus, ProjectSummary, ReadProjectArtifactResult, RecoverableJobStatus} from '@video-agent/runtime'

import {Command, Flags} from '@oclif/core'
import {listProjectArtifacts, listProjects, readProjectArtifact, readProjectEvents, readProjectStatus, recoverWorkspaceJobs, rerunProject} from '@video-agent/runtime'

export type TuiAction = 'artifact' | 'dashboard' | 'rerun' | 'worker'

interface TuiSnapshot {
  artifacts: ProjectArtifact[]
  events: ProjectEventRecord[]
  projects: ProjectSummary[]
  selected?: ProjectStatus
  workspaceDir: string
}

interface FormatTuiSnapshotOptions {
  artifactLimit: number
  eventLimit: number
}

export default class Tui extends Command {
  static description = 'Show a lightweight terminal workspace dashboard'
  static flags = {
    action: Flags.string({default: 'dashboard', description: 'Dashboard action to run before rendering', options: ['artifact', 'dashboard', 'rerun', 'worker']}),
    artifact: Flags.string({description: 'Artifact filename to inspect when --action artifact is used'}),
    'artifact-limit': Flags.integer({default: 8, description: 'Maximum artifacts to show for the selected project'}),
    'dry-run': Flags.boolean({description: 'Preview worker recovery when --action worker is used'}),
    'event-limit': Flags.integer({default: 6, description: 'Maximum recent events to show for the selected project'}),
    'from-stage': Flags.string({
      default: 'plan',
      description: 'Stage to start from when --action rerun is used',
      options: ['ingest', 'understand', 'plan', 'script', 'voiceover', 'quality'],
    }),
    json: Flags.boolean({description: 'Print machine-readable dashboard snapshot'}),
    limit: Flags.integer({description: 'Maximum recoverable jobs to process when --action worker is used'}),
    'max-attempts': Flags.integer({description: 'Skip jobs whose recovery stage attempt is greater than or equal to this value when --action worker is used'}),
    project: Flags.string({description: 'Project id to focus; defaults to the most recently updated project'}),
    'refresh-ms': Flags.integer({default: 2000, description: 'Refresh interval when --watch is enabled'}),
    status: Flags.string({default: 'active', description: 'Job status to recover when --action worker is used', options: ['active', 'failed', 'running']}),
    watch: Flags.boolean({description: 'Refresh the dashboard until interrupted'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Tui)
    const options = {
      artifactLimit: flags['artifact-limit'],
      eventLimit: flags['event-limit'],
    }

    const action = flags.action as TuiAction

    if (flags.watch && flags.json) {
      throw new Error('The tui command cannot combine --watch and --json.')
    }

    if (flags.watch && action !== 'dashboard') {
      throw new Error('The tui command cannot combine --watch with an action.')
    }

    if (flags.watch) {
      await this.watchDashboard(flags.workspace, flags.project, flags['refresh-ms'], options)
      return
    }

    const actionResult = await runTuiAction({
      action,
      artifactName: flags.artifact,
      dryRun: flags['dry-run'],
      fromStage: flags['from-stage'] as InitialPipelineStage,
      limit: flags.limit,
      maxAttempts: flags['max-attempts'],
      projectId: flags.project,
      status: flags.status,
      workspaceDir: flags.workspace,
    })
    const snapshot = await readTuiSnapshot({
      artifactLimit: flags['artifact-limit'],
      eventLimit: flags['event-limit'],
      projectId: flags.project,
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify({action: actionResult, snapshot}, null, 2))
      return
    }

    this.log([formatTuiActionResult(actionResult), formatTuiSnapshot(snapshot, options)].filter(Boolean).join('\n\n'))
  }

  private async watchDashboard(workspaceDir: string, projectId: string | undefined, refreshMs: number, options: FormatTuiSnapshotOptions): Promise<void> {
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const snapshot = await readTuiSnapshot({
        artifactLimit: options.artifactLimit,
        eventLimit: options.eventLimit,
        projectId,
        workspaceDir,
      })

      this.log('\u001Bc')
      this.log(formatTuiSnapshot(snapshot, options))
      // eslint-disable-next-line no-await-in-loop
      await wait(Math.max(250, refreshMs))
    }
  }
}

export interface ReadTuiSnapshotOptions {
  artifactLimit: number
  eventLimit: number
  projectId?: string
  workspaceDir: string
}

export interface RunTuiActionOptions {
  action: TuiAction
  artifactName?: string
  dryRun?: boolean
  fromStage: InitialPipelineStage
  limit?: number
  maxAttempts?: number
  projectId?: string
  status: string
  workspaceDir: string
}

export type TuiActionResult = {artifact: ReadProjectArtifactResult['artifact']; content: unknown; projectId: string; type: 'artifact'} | {dryRun: boolean; recovered: number; skipped: number; type: 'worker'} | {fromStage: InitialPipelineStage; projectId: string; status: string; type: 'rerun'} | {type: 'dashboard'}

export async function runTuiAction(options: RunTuiActionOptions): Promise<TuiActionResult> {
  if (options.action === 'dashboard') {
    return {type: 'dashboard'}
  }

  if (options.action === 'artifact') {
    if (options.artifactName === undefined) {
      throw new Error('Pass --artifact <name> when using --action artifact.')
    }

    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))
    const result = await readProjectArtifact(projectId, options.artifactName, options.workspaceDir)

    return {
      artifact: result.artifact,
      content: result.content,
      projectId,
      type: 'artifact',
    }
  }

  if (options.action === 'rerun') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))
    const result = await rerunProject(projectId, {
      fromStage: options.fromStage,
      workspaceDir: options.workspaceDir,
    })

    return {
      fromStage: options.fromStage,
      projectId: result.projectId,
      status: result.status,
      type: 'rerun',
    }
  }

  const result = await recoverWorkspaceJobs({
    dryRun: options.dryRun,
    limit: options.limit,
    maxAttempts: options.maxAttempts,
    statuses: resolveRecoverableStatuses(options.status),
    workspaceDir: options.workspaceDir,
  })

  return {
    dryRun: result.dryRun,
    recovered: result.recovered,
    skipped: result.skipped,
    type: 'worker',
  }
}

export async function readTuiSnapshot(options: ReadTuiSnapshotOptions): Promise<TuiSnapshot> {
  const projects = await listProjects(options.workspaceDir)
  const selectedProjectId = options.projectId ?? projects[0]?.projectId

  if (selectedProjectId === undefined) {
    return {
      artifacts: [],
      events: [],
      projects,
      workspaceDir: options.workspaceDir,
    }
  }

  const [selected, events, artifacts] = await Promise.all([
    readProjectStatus(selectedProjectId, options.workspaceDir),
    readProjectEvents(selectedProjectId, {limit: options.eventLimit, workspaceDir: options.workspaceDir}),
    listProjectArtifacts(selectedProjectId, options.workspaceDir).then((items) => items.slice(0, options.artifactLimit)),
  ])

  return {
    artifacts,
    events: events.events,
    projects,
    selected,
    workspaceDir: options.workspaceDir,
  }
}

export function formatTuiActionResult(result: TuiActionResult): string {
  if (result.type === 'dashboard') {
    return ''
  }

  if (result.type === 'artifact') {
    return [
      `Action: artifact ${result.projectId}/${result.artifact.name}`,
      `Kind: ${result.artifact.kind}`,
      `Size: ${result.artifact.size}B`,
      `Preview: ${formatArtifactPreview(result.content)}`,
    ].join('\n')
  }

  if (result.type === 'rerun') {
    return `Action: rerun ${result.projectId} from ${result.fromStage} -> ${result.status}`
  }

  return `Action: worker ${result.dryRun ? 'dry-run' : 'recover'} -> recovered ${result.recovered}, skipped ${result.skipped}`
}

export function formatTuiSnapshot(snapshot: TuiSnapshot, options: FormatTuiSnapshotOptions): string {
  const lines = [
    'Video Agent TUI',
    `Workspace: ${snapshot.workspaceDir}`,
    `Projects: ${snapshot.projects.length}`,
  ]

  if (snapshot.selected === undefined) {
    return [...lines, '', 'No projects found.'].join('\n')
  }

  lines.push(
    `Selected: ${snapshot.selected.projectId}`,
    `Job: ${snapshot.selected.job.status}`,
    '',
    'Pipeline',
    ...snapshot.selected.job.stages.map((stage) => formatStage(stage)),
    '',
    'Summary',
    `Quality: ${snapshot.selected.summary.quality.issues} issues (${snapshot.selected.summary.quality.errors} errors, ${snapshot.selected.summary.quality.warnings} warnings)`,
    `Providers: ${snapshot.selected.summary.providers.total} calls (${snapshot.selected.summary.providers.failed} failed)`,
    `Render: ${formatRenderSummary(snapshot.selected.summary.render)}`,
    '',
    `Artifacts (${snapshot.artifacts.length}/${snapshot.selected.artifacts.length}, limit ${options.artifactLimit})`,
    ...formatArtifacts(snapshot.artifacts),
    '',
    `Recent Events (${snapshot.events.length}, limit ${options.eventLimit})`,
    ...formatEvents(snapshot.events),
  )

  return lines.join('\n')
}

function formatStage(stage: ProjectStatus['job']['stages'][number]): string {
  return `  ${stage.name.padEnd(12)} ${stage.status}${stage.attempt === undefined ? '' : ` attempt=${stage.attempt}`}${stage.message === undefined ? '' : ` ${stage.message}`}`
}

function formatRenderSummary(render: ProjectStatus['summary']['render']): string {
  if (!render.rendered) {
    return 'none'
  }

  return `${render.renderer ?? 'unknown'} (${render.outputErrors} output errors, ${render.outputWarnings} output warnings, ${render.audioQualityWarnings} audio warnings, ${render.visualErrors} visual errors, ${render.visualWarnings} visual warnings)`
}

function formatArtifacts(artifacts: ProjectArtifact[]): string[] {
  if (artifacts.length === 0) {
    return ['  none']
  }

  return artifacts.map((artifact) => `  ${artifact.name.padEnd(28)} ${artifact.kind.padEnd(5)} ${artifact.size}B`)
}

function formatEvents(events: ProjectEventRecord[]): string[] {
  if (events.length === 0) {
    return ['  none']
  }

  return events.map((event) => `  ${event.time} ${event.kind.padEnd(8)} ${formatEventDetail(event)}`)
}

function formatEventDetail(record: ProjectEventRecord): string {
  if (record.kind === 'pipeline') {
    return `${record.event.type}${record.event.stage === undefined ? '' : ` ${record.event.stage}`}${record.event.message === undefined ? '' : ` ${record.event.message}`}`
  }

  return `${record.event.role} ${record.event.operation} ${record.event.status} ${record.event.durationMs}ms`
}

function formatArtifactPreview(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content)

  return text.length > 240 ? `${text.slice(0, 237)}...` : text
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function readMostRecentProjectId(workspaceDir: string): Promise<string> {
  const [project] = await listProjects(workspaceDir)

  if (project === undefined) {
    throw new Error('No projects found. Pass --project when using --action rerun.')
  }

  return project.projectId
}

function resolveRecoverableStatuses(status: string): RecoverableJobStatus[] {
  if (status === 'failed') {
    return ['failed']
  }

  if (status === 'running') {
    return ['running']
  }

  return ['failed', 'running']
}
