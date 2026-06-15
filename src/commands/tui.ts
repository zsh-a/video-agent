import type {ArtifactIntegrityResult, ExportFormat, ExportProjectResult, FfmpegAudioDiagnostics, InitialPipelineStage, PipelineCheckpointError as PipelineCheckpointErrorType, ProjectArtifact, ProjectEventRecord, ProjectQualityReport, ProjectRenderer, ProjectStatus, ProjectSummary, ProjectVisualSamplesReport, ProviderSmokeTestReport, ProviderSmokeTestRole, ReadProjectArtifactResult, RecoverableJobStatus, RecoverWorkspaceJobResult, RecoveryOrderBy, RenderProjectResult, VideoAgentGuidedAction} from '@video-agent/runtime'

import {Command, Flags} from '@oclif/core'
import {createVideoAgentGuidedActions, exportProject, ExportQualityError, inspectFfmpegAudio, listProjectArtifacts, listProjects, PipelineCheckpointError, readProjectArtifact, readProjectEvents, readProjectStatus, readProjectVisualSamples, recoverWorkspaceJobs, renderProject, rerunProject, runProviderSmokeTest, verifyProjectArtifacts} from '@video-agent/runtime'
import {createInterface, type Interface} from 'node:readline'

import {createCheckpointErrorPayload, formatCheckpointFailure} from '../utils/checkpoint-errors.js'
import {createExportQualityFailurePayload, formatExportQualityFailure} from './export.js'

export type TuiAction = 'artifact' | 'audio' | 'commands' | 'dashboard' | 'export' | 'provider-test' | 'render' | 'rerun' | 'select' | 'visual' | 'worker'

export interface TuiSnapshot {
  artifactIntegrity?: ArtifactIntegrityResult
  artifacts: ProjectArtifact[]
  events: ProjectEventRecord[]
  projects: ProjectSummary[]
  selected?: ProjectStatus
  workspaceDir: string
}

export interface FormatTuiSnapshotOptions {
  artifactLimit: number
  commandPrefix: string
  eventLimit: number
}

export type TuiCommandSuggestion = VideoAgentGuidedAction

export default class Tui extends Command {
  static description = 'Show a lightweight terminal workspace dashboard'
  static flags = {
    action: Flags.string({default: 'dashboard', description: 'Dashboard action to run before rendering', options: ['artifact', 'audio', 'commands', 'dashboard', 'export', 'provider-test', 'render', 'rerun', 'select', 'visual', 'worker']}),
    artifact: Flags.string({description: 'Artifact filename to inspect when --action artifact is used'}),
    'artifact-limit': Flags.integer({default: 8, description: 'Maximum artifacts to show for the selected project'}),
    'command-prefix': Flags.string({default: 'bun run dev', description: 'Command prefix used in TUI command suggestions'}),
    'dry-run': Flags.boolean({description: 'Preview worker recovery when --action worker is used'}),
    'event-limit': Flags.integer({default: 6, description: 'Maximum recent events to show for the selected project'}),
    'export-clean-output': Flags.boolean({description: 'Remove an existing directory output before exporting hyperframes or bundle formats when --action export is used'}),
    'export-format': Flags.string({default: 'video', description: 'Export format when --action export is used', options: ['video', 'hyperframes', 'bundle']}),
    'export-output': Flags.string({description: 'Output file or directory path when --action export is used'}),
    'export-require-quality': Flags.boolean({allowNo: true, default: true, description: 'Refuse export unless project quality is clean when --action export is used'}),
    frame: Flags.string({description: 'Sample frame path for VLM provider tests'}),
    'from-stage': Flags.string({
      default: 'plan',
      description: 'Stage to start from when --action rerun is used',
      options: ['ingest', 'understand', 'plan', 'script', 'voiceover', 'quality'],
    }),
    json: Flags.boolean({description: 'Print machine-readable dashboard snapshot'}),
    limit: Flags.integer({description: 'Maximum recoverable jobs to process when --action worker is used'}),
    'max-attempts': Flags.integer({description: 'Skip jobs whose recovery stage attempt is greater than or equal to this value when --action worker is used'}),
    media: Flags.string({description: 'Sample media path for ASR provider tests'}),
    'order-by': Flags.string({description: 'Recovery candidate ordering when --action worker is used', options: ['attempt', 'oldest', 'recent']}),
    project: Flags.string({description: 'Project id to focus; defaults to the most recently updated project'}),
    'provider-role': Flags.string({default: 'all', description: 'Provider role to test when --action provider-test is used', options: ['all', 'asr', 'tts', 'vlm']}),
    'refresh-ms': Flags.integer({default: 2000, description: 'Refresh interval when --watch is enabled'}),
    'render-audio': Flags.boolean({allowNo: true, default: true, description: 'Mix available source audio and TTS voiceover segments when --action render is used'}),
    'render-audio-ducking': Flags.boolean({description: 'Use voiceover sidechain compression to duck source audio when --action render is used'}),
    'render-ducking-attack-ms': Flags.integer({description: 'Audio ducking compressor attack in milliseconds when --action render is used'}),
    'render-ducking-ratio': Flags.integer({description: 'Audio ducking compressor ratio when --action render is used'}),
    'render-ducking-release-ms': Flags.integer({description: 'Audio ducking compressor release in milliseconds when --action render is used'}),
    'render-ducking-threshold': Flags.string({description: 'Audio ducking compressor threshold when --action render is used'}),
    'render-hyperframes-command': Flags.string({description: 'HyperFrames command prefix, either a binary name or JSON string array, when --action render is used'}),
    'render-hyperframes-output': Flags.string({description: 'Output path for HyperFrames CLI render when --action render is used'}),
    'render-hyperframes-render': Flags.boolean({description: 'Run HyperFrames CLI render after project generation when --action render is used'}),
    'render-hyperframes-validate': Flags.boolean({description: 'Run HyperFrames CLI validate after project generation when --action render is used'}),
    'render-output': Flags.string({description: 'Output video path or HyperFrames project directory when --action render is used'}),
    'render-renderer': Flags.string({default: 'ffmpeg', description: 'Renderer to use when --action render is used', options: ['ffmpeg', 'hyperframes']}),
    'render-source-volume': Flags.string({description: 'Source audio volume multiplier when --action render is used'}),
    'render-subtitles': Flags.boolean({allowNo: true, default: true, description: 'Burn narration subtitles when --action render is used'}),
    'render-voiceover-volume': Flags.string({description: 'Voiceover audio volume multiplier when --action render is used'}),
    'running-stale-after-ms': Flags.integer({description: 'Skip running jobs updated more recently than this threshold when --action worker is used'}),
    status: Flags.string({default: 'active', description: 'Job status to recover when --action worker is used', options: ['active', 'failed', 'running']}),
    text: Flags.string({description: 'Sample narration text for TTS provider tests'}),
    'visual-include-content': Flags.boolean({description: 'Include base64 image content when --action visual is used'}),
    watch: Flags.boolean({description: 'Refresh the dashboard until interrupted'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Tui)
    const options = {
      artifactLimit: flags['artifact-limit'],
      commandPrefix: flags['command-prefix'],
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

    let actionResult = await runTuiAction({
      action,
      artifactLimit: flags['artifact-limit'],
      artifactName: flags.artifact,
      commandPrefix: flags['command-prefix'],
      dryRun: flags['dry-run'],
      exportCleanOutput: flags['export-clean-output'],
      exportFormat: flags['export-format'] as ExportFormat,
      exportOutputPath: flags['export-output'],
      exportRequireQuality: flags['export-require-quality'],
      framePath: flags.frame,
      fromStage: flags['from-stage'] as InitialPipelineStage,
      limit: flags.limit,
      maxAttempts: flags['max-attempts'],
      mediaPath: flags.media,
      orderBy: flags['order-by'] as RecoveryOrderBy | undefined,
      projectId: flags.project,
      providerRole: flags['provider-role'],
      renderAudio: flags['render-audio'],
      renderAudioDucking: flags['render-audio-ducking'],
      renderDuckingAttackMs: flags['render-ducking-attack-ms'],
      renderDuckingRatio: flags['render-ducking-ratio'],
      renderDuckingReleaseMs: flags['render-ducking-release-ms'],
      renderDuckingThreshold: parseOptionalNumber(flags['render-ducking-threshold'], 'render-ducking-threshold'),
      renderHyperframesCommand: parseCommandPrefix(flags['render-hyperframes-command']),
      renderHyperframesOutput: flags['render-hyperframes-output'],
      renderHyperframesRender: flags['render-hyperframes-render'],
      renderHyperframesValidate: flags['render-hyperframes-validate'],
      renderOutputPath: flags['render-output'],
      renderRenderer: flags['render-renderer'] as ProjectRenderer,
      renderSourceVolume: parseOptionalNumber(flags['render-source-volume'], 'render-source-volume'),
      renderSubtitles: flags['render-subtitles'],
      renderVoiceoverVolume: parseOptionalNumber(flags['render-voiceover-volume'], 'render-voiceover-volume'),
      runningStaleAfterMs: flags['running-stale-after-ms'],
      status: flags.status,
      text: flags.text,
      visualIncludeContent: flags['visual-include-content'],
      workspaceDir: flags.workspace,
    })
    const snapshot = await readTuiSnapshot({
      artifactLimit: flags['artifact-limit'],
      eventLimit: flags['event-limit'],
      projectId: flags.project,
      workspaceDir: flags.workspace,
    })

    if (!flags.json && actionResult.type === 'select') {
      actionResult = {
        ...actionResult,
        selected: await promptTuiCommandSelection(actionResult.commands),
      }
    }

    if (flags.json) {
      this.log(JSON.stringify({action: actionResult, snapshot}, null, 2))
      if (actionResult.type === 'checkpoint-error' || actionResult.type === 'export-quality-error') {
        process.exitCode = 1
      }

      return
    }

    this.log([formatTuiActionResult(actionResult), formatTuiSnapshot(snapshot, options)].filter(Boolean).join('\n\n'))
    if (actionResult.type === 'checkpoint-error' || actionResult.type === 'export-quality-error') {
      process.exitCode = 1
    }
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
  artifactLimit: number
  artifactName?: string
  commandPrefix: string
  dryRun?: boolean
  exportCleanOutput?: boolean
  exportFormat: ExportFormat
  exportOutputPath?: string
  exportRequireQuality: boolean
  framePath?: string
  fromStage: InitialPipelineStage
  limit?: number
  maxAttempts?: number
  mediaPath?: string
  orderBy?: RecoveryOrderBy
  projectId?: string
  providerRole: string
  renderAudio?: boolean
  renderAudioDucking?: boolean
  renderDuckingAttackMs?: number
  renderDuckingRatio?: number
  renderDuckingReleaseMs?: number
  renderDuckingThreshold?: number
  renderHyperframesCommand?: string[]
  renderHyperframesOutput?: string
  renderHyperframesRender?: boolean
  renderHyperframesValidate?: boolean
  renderOutputPath?: string
  renderRenderer: ProjectRenderer
  renderSourceVolume?: number
  renderSubtitles?: boolean
  renderVoiceoverVolume?: number
  runningStaleAfterMs?: number
  status: string
  text?: string
  visualIncludeContent?: boolean
  workspaceDir: string
}

export type TuiCheckpointErrorActionResult = {action: 'rerun'; error: ReturnType<typeof createCheckpointErrorPayload>['error']; projectId: string; type: 'checkpoint-error'}
export type TuiExportQualityErrorActionResult = {action: 'export'; error: ReturnType<typeof createExportQualityFailurePayload>['error']; projectId: string; quality: ProjectQualityReport; type: 'export-quality-error'}
export type TuiActionResult =
  | TuiCheckpointErrorActionResult
  | TuiExportQualityErrorActionResult
  | {artifact: ReadProjectArtifactResult['artifact']; content: unknown; projectId: string; type: 'artifact'}
  | {commands: TuiCommandSuggestion[]; selected?: TuiCommandSuggestion; type: 'select'}
  | {commands: TuiCommandSuggestion[]; type: 'commands'}
  | {diagnostics: FfmpegAudioDiagnostics; projectId: string; type: 'audio'}
  | {dryRun: boolean; recovered: number; results: RecoverWorkspaceJobResult[]; skipped: number; type: 'worker'}
  | {fromStage: InitialPipelineStage; projectId: string; status: string; type: 'rerun'}
  | {report: ProjectVisualSamplesReport; type: 'visual'}
  | {report: ProviderSmokeTestReport; type: 'provider-test'}
  | {result: ExportProjectResult; type: 'export'}
  | {result: RenderProjectResult; type: 'render'}
  | {type: 'dashboard'}

// eslint-disable-next-line complexity
export async function runTuiAction(options: RunTuiActionOptions): Promise<TuiActionResult> {
  if (options.action === 'dashboard') {
    return {type: 'dashboard'}
  }

  if (options.action === 'commands') {
    return {
      commands: createTuiCommandSuggestions(await readTuiSnapshot({
        artifactLimit: options.artifactLimit,
        eventLimit: 0,
        projectId: options.projectId,
        workspaceDir: options.workspaceDir,
      }), {commandPrefix: options.commandPrefix}),
      type: 'commands',
    }
  }

  if (options.action === 'select') {
    return {
      commands: createTuiCommandSuggestions(await readTuiSnapshot({
        artifactLimit: options.artifactLimit,
        eventLimit: 0,
        projectId: options.projectId,
        workspaceDir: options.workspaceDir,
      }), {commandPrefix: options.commandPrefix}),
      type: 'select',
    }
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
    let result: Awaited<ReturnType<typeof rerunProject>>

    try {
      result = await rerunProject(projectId, {
        fromStage: options.fromStage,
        workspaceDir: options.workspaceDir,
      })
    } catch (error) {
      if (error instanceof PipelineCheckpointError) {
        return {
          action: 'rerun',
          error: createCheckpointErrorPayload(error).error,
          projectId,
          type: 'checkpoint-error',
        }
      }

      throw error
    }

    return {
      fromStage: options.fromStage,
      projectId: result.projectId,
      status: result.status,
      type: 'rerun',
    }
  }

  if (options.action === 'provider-test') {
    return {
      report: await runProviderSmokeTest({
        framePath: options.framePath,
        mediaPath: options.mediaPath,
        roles: resolveProviderSmokeTestRoles(options.providerRole),
        text: options.text,
        workspaceDir: options.workspaceDir,
      }),
      type: 'provider-test',
    }
  }

  if (options.action === 'audio') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))

    return {
      diagnostics: await inspectFfmpegAudio(projectId, {
        audio: options.renderAudio,
        audioDucking: options.renderAudioDucking,
        duckingAttackMs: options.renderDuckingAttackMs,
        duckingRatio: options.renderDuckingRatio,
        duckingReleaseMs: options.renderDuckingReleaseMs,
        duckingThreshold: options.renderDuckingThreshold,
        sourceVolume: options.renderSourceVolume,
        voiceoverVolume: options.renderVoiceoverVolume,
        workspaceDir: options.workspaceDir,
      }),
      projectId,
      type: 'audio',
    }
  }

  if (options.action === 'visual') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))

    return {
      report: await readProjectVisualSamples(projectId, {
        includeContent: options.visualIncludeContent,
        workspaceDir: options.workspaceDir,
      }),
      type: 'visual',
    }
  }

  if (options.action === 'render') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))

    return {
      result: await renderProject(projectId, {
        audio: options.renderAudio,
        audioDucking: options.renderAudioDucking,
        duckingAttackMs: options.renderDuckingAttackMs,
        duckingRatio: options.renderDuckingRatio,
        duckingReleaseMs: options.renderDuckingReleaseMs,
        duckingThreshold: options.renderDuckingThreshold,
        hyperframesCommand: options.renderHyperframesCommand,
        hyperframesOutput: options.renderHyperframesOutput,
        hyperframesRender: options.renderHyperframesRender,
        hyperframesValidate: options.renderHyperframesValidate,
        output: options.renderOutputPath,
        renderer: options.renderRenderer,
        sourceVolume: options.renderSourceVolume,
        subtitles: options.renderSubtitles,
        voiceoverVolume: options.renderVoiceoverVolume,
        workspaceDir: options.workspaceDir,
      }),
      type: 'render',
    }
  }

  if (options.action === 'export') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))

    try {
      return {
        result: await exportProject({
          cleanOutput: options.exportCleanOutput,
          format: options.exportFormat,
          outputPath: options.exportOutputPath,
          projectId,
          requireQuality: options.exportRequireQuality,
          workspaceDir: options.workspaceDir,
        }),
        type: 'export',
      }
    } catch (error) {
      if (error instanceof ExportQualityError) {
        return {
          action: 'export',
          error: createExportQualityFailurePayload(error.projectId, error.quality, error.message).error,
          projectId,
          quality: error.quality,
          type: 'export-quality-error',
        }
      }

      throw error
    }
  }

  const result = await recoverWorkspaceJobs({
    dryRun: options.dryRun,
    limit: options.limit,
    maxAttempts: options.maxAttempts,
    orderBy: options.orderBy,
    runningStaleAfterMs: options.runningStaleAfterMs,
    statuses: resolveRecoverableStatuses(options.status),
    workspaceDir: options.workspaceDir,
  })

  return {
    dryRun: result.dryRun,
    recovered: result.recovered,
    results: result.results,
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

  const [selected, events, artifacts, artifactIntegrity] = await Promise.all([
    readProjectStatus(selectedProjectId, options.workspaceDir),
    readProjectEvents(selectedProjectId, {limit: options.eventLimit, workspaceDir: options.workspaceDir}),
    listProjectArtifacts(selectedProjectId, options.workspaceDir).then((items) => items.slice(0, options.artifactLimit)),
    verifyProjectArtifacts(selectedProjectId, options.workspaceDir),
  ])

  return {
    artifactIntegrity,
    artifacts,
    events: events.events,
    projects,
    selected,
    workspaceDir: options.workspaceDir,
  }
}

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
    if (result.result.renderer === 'ffmpeg') {
      return [
        `Action: render ${result.result.projectId} -> ffmpeg`,
        `Output: ${result.result.outputPath}`,
        `Audio inputs: ${result.result.audioInputs}`,
        `Subtitles: ${result.result.subtitlePath ?? 'none'}`,
        `Artifact: ${result.result.artifactPath}`,
      ].join('\n')
    }

    return [
      `Action: render ${result.result.projectId} -> hyperframes`,
      `Output: ${result.result.outputDir}`,
      `Entry: ${result.result.entryHtml}`,
      `Validated: ${result.result.validation === undefined ? 'no' : 'yes'}`,
      `Rendered: ${result.result.rendered === undefined ? 'no' : 'yes'}`,
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

function formatTuiWorkerIssue(result: RecoverWorkspaceJobResult): string[] {
  const summary = `  ${result.projectId} ${result.status}${result.fromStage === undefined ? '' : ` from ${result.fromStage}`}${result.skipReason === undefined ? '' : ` (${result.skipReason})`}${result.error === undefined ? '' : ` - ${result.error}`}`
  const missing = result.missingArtifacts?.map((artifact) => `    missing: ${artifact}`) ?? []
  const changed = result.changedArtifacts?.map((artifact) => `    changed: ${artifact}`) ?? []
  const schemaInvalid = result.schemaInvalidArtifacts?.map((artifact) => `    schema invalid: ${artifact}`) ?? []
  const untracked = result.untrackedArtifacts?.map((artifact) => `    untracked: ${artifact}`) ?? []
  const validationIssues = result.validationIssues?.map((issue) => `    ${issue.path.join('.') || '<root>'}: ${issue.message}`) ?? []

  return [summary, ...missing, ...changed, ...schemaInvalid, ...untracked, ...validationIssues]
}

function createCheckpointErrorFromPayload(error: TuiCheckpointErrorActionResult['error']): PipelineCheckpointErrorType {
  return new PipelineCheckpointError(error.fromStage as InitialPipelineStage, {
    changedArtifacts: error.changedArtifacts,
    missingArtifacts: error.missingArtifacts,
    schemaInvalidArtifacts: error.schemaInvalidArtifacts,
    untrackedArtifacts: error.untrackedArtifacts,
  })
}

function indent(text: string): string {
  return text.split('\n').map((line) => `  ${line}`).join('\n')
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

export function createTuiCommandSuggestions(snapshot: TuiSnapshot, options: {commandPrefix: string}): TuiCommandSuggestion[] {
  return createVideoAgentGuidedActions({
    artifacts: snapshot.artifacts,
    commandPrefix: options.commandPrefix,
    status: snapshot.selected,
    workspaceDir: snapshot.workspaceDir,
  })
}

export function formatTuiCommands(commands: TuiCommandSuggestion[]): string[] {
  if (commands.length === 0) {
    return ['  none']
  }

  return commands.map((item) => `  ${item.label.padEnd(24)} ${item.command}`)
}

export function formatTuiCommandSelector(commands: TuiCommandSuggestion[]): string[] {
  if (commands.length === 0) {
    return ['Guided Actions', '  none']
  }

  return [
    'Guided Actions',
    ...commands.flatMap((item, index) => {
      const category = item.category === undefined ? '' : ` [${item.category}]`
      const description = item.description === undefined ? [] : [`      ${item.description}`]

      return [
        `  ${String(index + 1).padStart(2, ' ')}. ${item.label}${category}`,
        ...description,
        `      ${item.command}`,
      ]
    }),
  ]
}

export function resolveTuiCommandSelection(commands: TuiCommandSuggestion[], choice: string): TuiCommandSuggestion | undefined {
  const normalized = choice.trim()

  if (normalized === '') {
    return undefined
  }

  const selectedIndex = Number.parseInt(normalized, 10)

  if (String(selectedIndex) === normalized && selectedIndex >= 1 && selectedIndex <= commands.length) {
    return commands[selectedIndex - 1]
  }

  return commands.find((item) => item.id === normalized || item.label.toLowerCase() === normalized.toLowerCase())
}

async function promptTuiCommandSelection(commands: TuiCommandSuggestion[]): Promise<TuiCommandSuggestion | undefined> {
  if (commands.length === 0) {
    return undefined
  }

  const prompt = [
    ...formatTuiCommandSelector(commands),
    '',
    'Select action by number or id, or press enter to skip: ',
  ].join('\n')
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    const choice = await askQuestion(readline, prompt)
    const selected = resolveTuiCommandSelection(commands, choice)

    if (selected === undefined && choice.trim() !== '') {
      throw new Error(`No guided action matched "${choice.trim()}".`)
    }

    return selected
  } finally {
    readline.close()
  }
}

async function askQuestion(readline: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    readline.question(prompt, resolve)
  })
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

function resolveProviderSmokeTestRoles(role: string): ProviderSmokeTestRole[] | undefined {
  if (role === 'all') {
    return undefined
  }

  if (role === 'asr' || role === 'tts' || role === 'vlm') {
    return [role]
  }

  throw new Error(`Invalid provider role: ${role}`)
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

function resolveRecoverableStatuses(status: string): RecoverableJobStatus[] {
  if (status === 'failed') {
    return ['failed']
  }

  if (status === 'running') {
    return ['running']
  }

  return ['failed', 'running']
}

function parseOptionalNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Flag --${flag} must be a finite number.`)
  }

  return parsed
}

function parseCommandPrefix(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  const trimmed = value.trim()

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown

    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== 'string' || part.length === 0)) {
      throw new Error('HyperFrames command JSON must be a non-empty string array.')
    }

    return parsed
  }

  return [trimmed]
}
