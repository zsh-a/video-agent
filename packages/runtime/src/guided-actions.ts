import type {ProjectArtifact} from './artifacts.js'
import type {ProjectStatus} from './project-status.js'

import {listProjectArtifacts} from './artifacts.js'
import {readProjectStatus} from './project-status.js'
import {listProjects} from './projects.js'

export type VideoAgentGuidedActionCategory = 'artifact' | 'dashboard' | 'export' | 'inspect' | 'provider' | 'recover' | 'render' | 'rerun'

export interface VideoAgentGuidedAction {
  category: VideoAgentGuidedActionCategory
  command: string
  description: string
  id: string
  label: string
  priority: number
}

export interface CreateVideoAgentGuidedActionsOptions {
  artifacts?: ProjectArtifact[]
  commandPrefix?: string
  status?: ProjectStatus
  workspaceDir: string
}

export interface ReadVideoAgentGuidedActionsOptions {
  artifactLimit?: number
  commandPrefix?: string
  projectId?: string
  workspaceDir?: string
}

export interface VideoAgentGuidedActionsResult {
  actions: VideoAgentGuidedAction[]
  projectId?: string
  workspaceDir: string
}

export async function readVideoAgentGuidedActions(options: ReadVideoAgentGuidedActionsOptions = {}): Promise<VideoAgentGuidedActionsResult> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projects = await listProjects(workspaceDir)
  const projectId = options.projectId ?? projects[0]?.projectId

  if (projectId === undefined) {
    return {
      actions: createVideoAgentGuidedActions({
        commandPrefix: options.commandPrefix,
        workspaceDir,
      }),
      workspaceDir,
    }
  }

  const [status, artifacts] = await Promise.all([
    readProjectStatus(projectId, workspaceDir),
    listProjectArtifacts(projectId, workspaceDir).then((items) => items.slice(0, options.artifactLimit ?? 5)),
  ])

  return {
    actions: createVideoAgentGuidedActions({
      artifacts,
      commandPrefix: options.commandPrefix,
      status,
      workspaceDir,
    }),
    projectId,
    workspaceDir,
  }
}

export function createVideoAgentGuidedActions(options: CreateVideoAgentGuidedActionsOptions): VideoAgentGuidedAction[] {
  const commandPrefix = options.commandPrefix ?? 'vagent'
  const actions: VideoAgentGuidedAction[] = [
    createGuidedAction(commandPrefix, {
      args: ['tui', '--action', 'provider-test', '--workspace', options.workspaceDir],
      category: 'provider',
      description: 'Run ASR, VLM, and TTS provider smoke tests for the current workspace.',
      id: 'provider-test',
      label: 'Test providers',
      priority: 30,
    }),
    createGuidedAction(commandPrefix, {
      args: ['worker', '--dry-run', '--workspace', options.workspaceDir],
      category: 'recover',
      description: 'Preview recoverable failed or stale running jobs without mutating state.',
      id: 'worker-dry-run',
      label: 'Preview worker recovery',
      priority: 40,
    }),
    createGuidedAction(commandPrefix, {
      args: ['projects', '--workspace', options.workspaceDir],
      category: 'inspect',
      description: 'List projects in the workspace.',
      id: 'list-projects',
      label: 'List projects',
      priority: 80,
    }),
  ]

  if (options.status === undefined) {
    return sortGuidedActions(actions)
  }

  const {projectId} = options.status
  const [firstArtifact] = options.artifacts ?? []
  const rerunStage = findSuggestedRerunStage(options.status)

  actions.push(
    createGuidedAction(commandPrefix, {
      args: ['tui', '--project', projectId, '--workspace', options.workspaceDir],
      category: 'dashboard',
      description: 'Open the focused project dashboard once.',
      id: 'open-dashboard',
      label: 'Open dashboard',
      priority: 10,
    }),
    createGuidedAction(commandPrefix, {
      args: ['tui', '--project', projectId, '--watch', '--workspace', options.workspaceDir],
      category: 'dashboard',
      description: 'Watch the focused project dashboard with periodic refresh.',
      id: 'watch-dashboard',
      label: 'Watch dashboard',
      priority: 20,
    }),
    createGuidedAction(commandPrefix, {
      args: ['status', projectId, '--workspace', options.workspaceDir],
      category: 'inspect',
      description: 'Inspect job state, provider summary, quality summary, and artifacts.',
      id: 'inspect-status',
      label: 'Inspect status',
      priority: 25,
    }),
    createGuidedAction(commandPrefix, {
      args: ['quality', projectId, '--workspace', options.workspaceDir],
      category: 'inspect',
      description: 'Inspect aggregate project quality and deliverability diagnostics.',
      id: 'inspect-quality',
      label: 'Inspect quality',
      priority: 35,
    }),
    createGuidedAction(commandPrefix, {
      args: ['quality', projectId, '--details', '--json', '--workspace', options.workspaceDir],
      category: 'inspect',
      description: 'Inspect aggregate quality with raw quality-report and render-output details.',
      id: 'inspect-quality-details',
      label: 'Inspect quality details',
      priority: 36,
    }),
    createGuidedAction(commandPrefix, {
      args: ['artifacts', projectId, '--verify', '--workspace', options.workspaceDir],
      category: 'artifact',
      description: 'Verify artifact manifest hashes and known IR/provider schemas.',
      id: 'verify-artifacts',
      label: 'Verify artifacts',
      priority: 37,
    }),
    createGuidedAction(commandPrefix, {
      args: ['events', projectId, '--workspace', options.workspaceDir],
      category: 'inspect',
      description: 'Read recent pipeline and provider events for the focused project.',
      id: 'read-events',
      label: 'Read events',
      priority: 50,
    }),
    createGuidedAction(commandPrefix, {
      args: ['visual', projectId, '--json', '--workspace', options.workspaceDir],
      category: 'inspect',
      description: 'Inspect rendered visual frame sample metadata and content hashes.',
      id: 'inspect-visual-samples',
      label: 'Inspect visual samples',
      priority: 51,
    }),
    createGuidedAction(commandPrefix, {
      args: ['render', projectId, '--workspace', options.workspaceDir],
      category: 'render',
      description: 'Render the focused project with the default renderer settings.',
      id: 'render-final-video',
      label: 'Render final video',
      priority: 60,
    }),
    createGuidedAction(commandPrefix, {
      args: ['export', projectId, '--require-quality', '--workspace', options.workspaceDir],
      category: 'export',
      description: 'Export the latest rendered output only after project quality passes.',
      id: 'export-output',
      label: 'Export output',
      priority: 70,
    }),
  )

  if (rerunStage !== undefined) {
    actions.push(createGuidedAction(commandPrefix, {
      args: ['tui', '--project', projectId, '--action', 'rerun', '--from-stage', rerunStage, '--workspace', options.workspaceDir],
      category: 'rerun',
      description: `Rerun the focused project from the first unfinished stage, ${rerunStage}.`,
      id: 'rerun-suggested-stage',
      label: `Rerun from ${rerunStage}`,
      priority: 15,
    }))
  }

  if (firstArtifact !== undefined) {
    actions.push(createGuidedAction(commandPrefix, {
      args: ['tui', '--project', projectId, '--action', 'artifact', '--artifact', firstArtifact.name, '--workspace', options.workspaceDir],
      category: 'artifact',
      description: `Preview the ${firstArtifact.name} artifact content from the focused project.`,
      id: 'open-artifact',
      label: `Open artifact ${firstArtifact.name}`,
      priority: 55,
    }))
  }

  return sortGuidedActions(actions)
}

function createGuidedAction(prefix: string, options: {
  args: string[]
  category: VideoAgentGuidedActionCategory
  description: string
  id: string
  label: string
  priority: number
}): VideoAgentGuidedAction {
  return {
    category: options.category,
    command: buildCommand(prefix, options.args),
    description: options.description,
    id: options.id,
    label: options.label,
    priority: options.priority,
  }
}

function sortGuidedActions(actions: VideoAgentGuidedAction[]): VideoAgentGuidedAction[] {
  return [...actions].sort((left, right) => left.priority - right.priority)
}

function buildCommand(prefix: string, args: string[]): string {
  return [prefix, ...args.map((arg) => shellQuote(arg))].join(' ')
}

function shellQuote(value: string): string {
  if (/^[\w./:@-]+$/.test(value)) {
    return value
  }

  return `'${value.replaceAll("'", String.raw`'\''`)}'`
}

function findSuggestedRerunStage(status: ProjectStatus): string | undefined {
  const rerunnableStages = new Set(['ingest', 'plan', 'quality', 'script', 'understand', 'voiceover'])
  const stage = status.job.stages.find((item) => item.status === 'failed') ?? status.job.stages.find((item) => item.status === 'running') ?? status.job.stages.find((item) => item.status === 'pending')

  if (stage === undefined || !rerunnableStages.has(stage.name)) {
    return undefined
  }

  return stage.name
}
