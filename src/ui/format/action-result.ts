import type {RecoverFilmWorkspaceJobResult} from '@video-agent/pipeline-film'
import type {PipelineCheckpointError as PipelineCheckpointErrorType, ProviderSmokeTestReport} from '@video-agent/runtime'
import type {TuiActionResult, TuiCheckpointErrorActionResult} from '../actions/types.js'

import {PipelineCheckpointError} from '@video-agent/runtime'

import {formatCheckpointFailure} from '../../utils/checkpoint-errors.js'
import {formatExportQualityFailure} from '../../utils/export-output.js'
import {formatQualityRenderSummary} from '../../utils/quality-output.js'
import {formatProjectStatus} from '../../utils/status-output.js'
import {formatTuiCommands} from './command.js'
import {formatTuiEventRecord} from './event.js'

// eslint-disable-next-line complexity
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

  if (result.type === 'commands') {
    return ['Action: commands', ...formatTuiCommands(result.commands)].join('\n')
  }

  if (result.type === 'select') {
    if (result.selected === undefined) {
      return 'Action: select -> no action selected'
    }

    return [
      `Action: select -> ${result.selected.id ?? result.selected.label}`,
      `Command: ${result.selected.command}`,
    ].join('\n')
  }

  if (result.type === 'rerun') {
    return `Action: rerun ${result.projectId} from ${result.fromStage} -> ${result.status}`
  }

  if (result.type === 'export') {
    return [
      `Action: export ${result.result.projectId} -> ${result.result.format}`,
      `Source: ${result.result.sourcePath}`,
      `Output: ${result.result.outputPath}`,
      `Clean output: ${result.result.cleanOutput ? 'yes' : 'no'}`,
      `Quality gate: ${result.result.requireQuality ? 'required' : 'not required'}`,
      `Artifact: ${result.result.artifactPath}`,
    ].join('\n')
  }

  if (result.type === 'render') {
    return [
      `Action: render ${result.result.projectId} -> ffmpeg`,
      `Output: ${result.result.outputPath}`,
      `Audio inputs: ${result.result.audioInputs}`,
      `Subtitles: ${result.result.subtitlePath ?? 'none'}`,
      `Artifact: ${result.result.artifactPath}`,
    ].join('\n')
  }

  if (result.type === 'audio') {
    return [
      `Action: audio ${result.projectId} -> available ${result.diagnostics.availableVoiceovers}, missing ${result.diagnostics.missingVoiceovers.length}`,
      ...result.diagnostics.warnings.map((warning) => `  warning: ${warning}`),
      ...result.diagnostics.missingVoiceovers.map((voiceover) => `  missing: ${voiceover.narrationId ?? `index ${voiceover.index}`} (${voiceover.reason})`),
      ...result.diagnostics.plan.segments.map((voiceover) => `  voiceover: ${voiceover.narrationId ?? `index ${voiceover.index}`}\t${voiceover.status}\tstart=${voiceover.start}`),
    ].join('\n')
  }

  if (result.type === 'quality') {
    return [
      `Action: quality ${result.report.projectId} -> ${result.report.ok ? 'ok' : 'needs attention'}`,
      `Errors: ${result.report.summary.errors}`,
      `Warnings: ${result.report.summary.warnings}`,
      `Pipeline: ${result.report.pipeline.errors} errors, ${result.report.pipeline.warnings} warnings`,
      `Content: ${result.report.content.errors} errors, ${result.report.content.warnings} warnings`,
      `Render: ${formatQualityRenderSummary(result.report.render)}`,
      `Artifacts: ${result.report.artifacts.ok ? 'ok' : 'not ok'} (${result.report.artifacts.summary.changed} changed, ${result.report.artifacts.summary.missing} missing, ${result.report.artifacts.summary.schemaInvalid} schema invalid, ${result.report.artifacts.summary.untracked} untracked)`,
      `Details: ${result.report.qualityReport === undefined && result.report.renderOutput === undefined ? 'not included' : 'included'}`,
    ].join('\n')
  }

  if (result.type === 'projects') {
    return [
      `Action: projects -> ${result.projects.length} projects`,
      ...(result.projects.length === 0 ? ['  none'] : result.projects.map((project) => `  ${project.projectId}\t${project.status}\t${project.updatedAt}`)),
    ].join('\n')
  }

  if (result.type === 'events') {
    return [
      `Action: events ${result.result.projectId} -> ${result.result.events.length} events`,
      ...(result.result.events.length === 0 ? ['  none'] : result.result.events.map((event) => `  ${formatTuiEventRecord(event)}`)),
    ].join('\n')
  }

  if (result.type === 'status') {
    return [
      `Action: status ${result.status.projectId}`,
      formatProjectStatus(result.status),
    ].join('\n')
  }

  if (result.type === 'verify') {
    return [
      `Action: verify ${result.projectId} -> ${result.result.ok ? 'ok' : 'failed'}`,
      `Manifest: ${result.result.manifestPath}`,
      `Checked: ${result.result.summary.checked}`,
      `Summary: ${result.result.summary.errors} errors, ${result.result.summary.warnings} warnings (${result.result.summary.missing} missing, ${result.result.summary.changed} changed, ${result.result.summary.schemaInvalid} schema invalid, ${result.result.summary.untracked} untracked)`,
      ...result.result.missing.map((issue) => `  missing: ${issue.name}`),
      ...result.result.changed.map((issue) => `  changed: ${issue.name}`),
      ...result.result.schemaInvalid.flatMap((issue) => [
        `  schema invalid: ${issue.name}`,
        ...issue.issues.map((schemaIssue) => `    ${schemaIssue.path.join('.') || '<root>'}: ${schemaIssue.message}`),
      ]),
      ...result.result.untracked.map((artifact) => `  untracked: ${artifact}`),
    ].join('\n')
  }

  if (result.type === 'visual') {
    return [
      `Action: visual ${result.report.projectId} -> ${result.report.samples.length} samples`,
      ...result.report.samples.map((sample) => {
        const status = sample.exists ? (sample.ok ? 'ok' : 'failed') : 'missing'
        const details = [
          `t=${sample.timestamp}`,
          status,
          sample.relativePath ?? sample.path ?? 'no-path',
          sample.size === undefined ? undefined : `${sample.size}B`,
          sample.reportSha256 === undefined ? undefined : `sha256=${sample.reportSha256}`,
          sample.contentBase64 === undefined ? undefined : `content=${sample.contentBase64.length}b64`,
          sample.error === undefined ? undefined : `error=${sample.error}`,
        ].filter((item): item is string => item !== undefined)

        return `  ${details.join(' ')}`
      }),
    ].join('\n')
  }

  if (result.type === 'checkpoint-error') {
    return [
      `Action: ${result.action} ${result.projectId} from ${result.error.fromStage} -> checkpoint-invalid`,
      indent(formatCheckpointFailure(createCheckpointErrorFromPayload(result.error))),
    ].join('\n')
  }

  if (result.type === 'export-quality-error') {
    return [
      `Action: export ${result.projectId} -> export-quality-failed`,
      indent(formatExportQualityFailure(result.projectId, result.quality)),
    ].join('\n')
  }

  if (result.type === 'provider-test') {
    return [
      `Action: provider-test -> ${result.report.ok ? 'ok' : 'failed'} (${result.report.summary.succeeded}/${result.report.summary.total} succeeded, ${result.report.summary.failed} failed)`,
      ...result.report.results.map((item) => {
        if (item.status === 'failed') {
          return `  ${item.role}:${item.provider} failed ${item.durationMs}ms - ${item.error?.message ?? 'unknown error'}`
        }

        const metadata = item.metadata === undefined ? '' : ` request=${item.metadata.requestId ?? 'n/a'} model=${item.metadata.model ?? 'n/a'}`

        return `  ${item.role}:${item.provider} succeeded ${item.durationMs}ms ${formatProviderSmokeOutput(item.output)}${metadata}`.trimEnd()
      }),
    ].join('\n')
  }

  return [
    `Action: worker ${result.dryRun ? 'dry-run' : 'recover'} -> recovered ${result.recovered}, skipped ${result.skipped}`,
    ...result.results.filter((item) => item.status === 'skipped' || item.status === 'failed').flatMap((item) => formatTuiWorkerIssue(item)),
  ].join('\n')
}

function formatTuiWorkerIssue(result: RecoverFilmWorkspaceJobResult): string[] {
  const summary = `  ${result.projectId} ${result.status}${result.fromStage === undefined ? '' : ` from ${result.fromStage}`}${result.skipReason === undefined ? '' : ` (${result.skipReason})`}${result.error === undefined ? '' : ` - ${result.error}`}`
  const missing = result.missingArtifacts?.map((artifact) => `    missing: ${artifact}`) ?? []
  const changed = result.changedArtifacts?.map((artifact) => `    changed: ${artifact}`) ?? []
  const schemaInvalid = result.schemaInvalidArtifacts?.map((artifact) => `    schema invalid: ${artifact}`) ?? []
  const untracked = result.untrackedArtifacts?.map((artifact) => `    untracked: ${artifact}`) ?? []
  const validationIssues = result.validationIssues?.map((issue) => `    ${issue.path.join('.') || '<root>'}: ${issue.message}`) ?? []

  return [summary, ...missing, ...changed, ...schemaInvalid, ...untracked, ...validationIssues]
}

function createCheckpointErrorFromPayload(error: TuiCheckpointErrorActionResult['error']): PipelineCheckpointErrorType {
  return new PipelineCheckpointError(error.fromStage, {
    changedArtifacts: error.changedArtifacts,
    missingArtifacts: error.missingArtifacts,
    schemaInvalidArtifacts: error.schemaInvalidArtifacts,
    untrackedArtifacts: error.untrackedArtifacts,
  })
}

function indent(text: string): string {
  return text.split('\n').map((line) => `  ${line}`).join('\n')
}

function formatArtifactPreview(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content)

  return text.length > 240 ? `${text.slice(0, 237)}...` : text
}

function formatProviderSmokeOutput(output: ProviderSmokeTestReport['results'][number]['output']): string {
  if (output === undefined) {
    return 'output=none'
  }

  if (output.type === 'transcript') {
    return `segments=${output.segments} characters=${output.characters}`
  }

  if (output.type === 'tts') {
    return `segments=${output.segments} duration=${output.duration}s`
  }

  return `scenes=${output.scenes} evidence=${output.evidence}`
}
