import type {ArtifactIntegrityResult, ProjectArtifact, ProjectStatus} from '@video-agent/runtime'
import type {FormatTuiSnapshotOptions, TuiSnapshot} from './tui-model.js'

import {createTuiCommandSuggestions, formatTuiCommands} from './tui-command-format.js'
import {formatEvents} from './tui-event-format.js'

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
    ...(snapshot.artifactIntegrity === undefined ? [] : [`Artifact Integrity: ${formatArtifactIntegritySummary(snapshot.artifactIntegrity)}`]),
    '',
    `Artifacts (${snapshot.artifacts.length}/${snapshot.selected.artifacts.length}, limit ${options.artifactLimit})`,
    ...formatArtifacts(snapshot.artifacts),
    '',
    `Recent Events (${snapshot.events.length}, limit ${options.eventLimit})`,
    ...formatEvents(snapshot.events),
    '',
    'Commands',
    ...formatTuiCommands(createTuiCommandSuggestions(snapshot, {commandPrefix: options.commandPrefix})),
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

function formatArtifactIntegritySummary(integrity: ArtifactIntegrityResult): string {
  return [
    integrity.ok ? 'ok' : 'needs attention',
    `${integrity.summary.errors} errors`,
    `${integrity.summary.warnings} warnings`,
    `${integrity.summary.checked} checked`,
    `${integrity.summary.missing} missing`,
    `${integrity.summary.changed} changed`,
    `${integrity.summary.schemaInvalid} schema invalid`,
    `${integrity.summary.untracked} untracked`,
  ].join(', ')
}

function formatArtifacts(artifacts: ProjectArtifact[]): string[] {
  if (artifacts.length === 0) {
    return ['  none']
  }

  return artifacts.map((artifact) => `  ${artifact.name.padEnd(28)} ${artifact.kind.padEnd(5)} ${artifact.size}B`)
}
