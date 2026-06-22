import type {FilmPipelineStage, FilmRecoveryOrderBy, FilmRecoveryStatusOption} from '@video-agent/pipeline-film'
import type {PipelineEventType} from '@video-agent/core'
import type {ExportFormat, ProjectEventKind, ProviderCallRole, ProviderCallStatus, ProviderSmokeTestRoleOption} from '@video-agent/runtime'
import type {RunTuiActionOptions} from '../ui/actions/index.js'
import type {FormatTuiSnapshotOptions, TuiAction, TuiCommandSuggestion} from '../ui/model.js'

import {Command, Flags} from '@oclif/core'
import {PIPELINE_EVENT_TYPES} from '@video-agent/core'
import {FILM_PIPELINE_STAGES, FILM_RECOVERY_ORDER_BY_VALUES, FILM_RECOVERY_STATUS_OPTIONS} from '@video-agent/pipeline-film'
import {EXPORT_FORMATS, PROJECT_EVENT_KINDS, PROVIDER_CALL_ROLES, PROVIDER_CALL_STATUSES, PROVIDER_SMOKE_TEST_ROLE_OPTIONS} from '@video-agent/runtime'
import {createInterface, type Interface} from 'node:readline'

import {readTuiSnapshot, runTuiAction} from '../ui/actions/index.js'
import {createTuiCommandSuggestions, formatTuiActionResult, formatTuiCommandSelector, formatTuiSnapshot, resolveTuiCommandSelection} from '../ui/format/console.js'
import {type TuiManagerActionRequest, launchTuiManager} from '../ui/manager/index.js'
import {TUI_ACTIONS} from '../ui/model.js'
import {normalizeNonNegativeIntegerFlag, normalizePositiveIntegerFlag, normalizeRequiredNonNegativeIntegerFlag, normalizeRequiredPositiveIntegerFlag, parseOptionalEnumFlag, parseOptionalNumberFlag, parseRequiredEnumFlag, workspaceFlag} from '../utils/cli-flags.js'

export default class Tui extends Command {
  static description = 'Manage video-agent workspace projects in the terminal'
  static flags = {
    action: Flags.string({default: 'dashboard', description: 'Dashboard action to run before rendering', options: [...TUI_ACTIONS]}),
    artifact: Flags.string({description: 'Artifact filename to inspect when --action artifact is used'}),
    'artifact-limit': Flags.integer({default: 8, description: 'Maximum artifacts to show for the selected project'}),
    'command-prefix': Flags.string({default: 'bun run dev', description: 'Command prefix used in TUI command suggestions'}),
    'dry-run': Flags.boolean({description: 'Preview Film worker recovery when --action worker is used'}),
    'event-kind': Flags.string({description: 'Event kind filter when --action events is used', options: [...PROJECT_EVENT_KINDS]}),
    'event-limit': Flags.integer({default: 6, description: 'Maximum recent events to show for the selected project'}),
    'event-provider-role': Flags.string({description: 'Provider role filter when --action events is used', options: [...PROVIDER_CALL_ROLES]}),
    'event-provider-status': Flags.string({description: 'Provider status filter when --action events is used', options: [...PROVIDER_CALL_STATUSES]}),
    'event-stage': Flags.string({description: 'Pipeline stage filter when --action events is used'}),
    'event-type': Flags.string({description: 'Pipeline event type filter when --action events is used', options: [...PIPELINE_EVENT_TYPES]}),
    'export-clean-output': Flags.boolean({description: 'Remove an existing directory output before exporting bundle format when --action export is used'}),
    'export-format': Flags.string({description: 'Export format when --action export is used.', options: [...EXPORT_FORMATS]}),
    'export-output': Flags.string({description: 'Output file or directory path when --action export is used'}),
    'export-require-quality': Flags.boolean({allowNo: true, default: true, description: 'Refuse export unless project quality is clean when --action export is used'}),
    frame: Flags.string({description: 'Sample frame path for VLM provider tests; required when --provider-role all or --provider-role vlm'}),
    'from-stage': Flags.string({
      description: 'Stage to start from when --action rerun is used',
      options: [...FILM_PIPELINE_STAGES],
    }),
    interactive: Flags.boolean({allowNo: true, default: true, description: 'Use the interactive Ink manager when a TTY is available'}),
    json: Flags.boolean({description: 'Print machine-readable dashboard snapshot'}),
    limit: Flags.integer({description: 'Maximum recoverable Film jobs to process when --action worker is used'}),
    'max-attempts': Flags.integer({description: 'Skip Film jobs whose recovery stage attempt is greater than or equal to this value when --action worker is used'}),
    media: Flags.string({description: 'Sample media path for ASR provider tests; required when --provider-role all or --provider-role asr'}),
    'order-by': Flags.string({description: 'Film recovery candidate ordering when --action worker is used', options: [...FILM_RECOVERY_ORDER_BY_VALUES]}),
    project: Flags.string({description: 'Project id to focus; defaults to the most recently updated project'}),
    'provider-role': Flags.string({default: 'all', description: 'Provider role to test when --action provider-test is used', options: [...PROVIDER_SMOKE_TEST_ROLE_OPTIONS]}),
    'quality-details': Flags.boolean({description: 'Include raw quality-report.json and render-output.json content when --action quality is used'}),
    'refresh-ms': Flags.integer({default: 2000, description: 'Refresh interval for the interactive manager or --watch dashboard'}),
    'render-audio': Flags.boolean({allowNo: true, default: true, description: 'Mix available source audio and TTS voiceover segments when --action render is used'}),
    'render-audio-ducking': Flags.boolean({description: 'Use voiceover sidechain compression to duck source audio when --action render is used'}),
    'render-ducking-attack-ms': Flags.integer({description: 'Audio ducking compressor attack in milliseconds when --action render is used'}),
    'render-ducking-ratio': Flags.integer({description: 'Audio ducking compressor ratio when --action render is used'}),
    'render-ducking-release-ms': Flags.integer({description: 'Audio ducking compressor release in milliseconds when --action render is used'}),
    'render-ducking-threshold': Flags.string({description: 'Audio ducking compressor threshold when --action render is used'}),
    'render-output': Flags.string({description: 'Output video path when --action render is used'}),
    'render-source-volume': Flags.string({description: 'Source audio volume multiplier when --action render is used'}),
    'render-subtitles': Flags.boolean({allowNo: true, default: true, description: 'Burn narration subtitles when --action render is used'}),
    'render-voiceover-volume': Flags.string({description: 'Voiceover audio volume multiplier when --action render is used'}),
    'running-stale-after-ms': Flags.integer({description: 'Skip running Film jobs updated more recently than this threshold when --action worker is used'}),
    status: Flags.string({default: 'active', description: 'Film job status to recover when --action worker is used', options: [...FILM_RECOVERY_STATUS_OPTIONS]}),
    text: Flags.string({description: 'Sample narration text for TTS provider tests; required when --provider-role all or --provider-role tts'}),
    'visual-include-content': Flags.boolean({description: 'Include base64 image content when --action visual is used'}),
    watch: Flags.boolean({description: 'Refresh the dashboard until interrupted'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Tui)
    const integerFlagValues = parseTuiIntegerFlagValues(flags)
    const options = {
      artifactLimit: integerFlagValues.artifactLimit,
      commandPrefix: flags['command-prefix'],
      eventLimit: integerFlagValues.eventLimit,
    }

    const action = parseRequiredEnumFlag<TuiAction>(flags.action, TUI_ACTIONS, '--action')
    const actionFlagValues = parseTuiActionFlagValues(flags)

    if (flags.watch && flags.json) {
      throw new Error('The tui command cannot combine --watch and --json.')
    }

    if (flags.watch && action !== 'dashboard') {
      throw new Error('The tui command cannot combine --watch with an action.')
    }

    if (shouldLaunchInteractiveTui({
      action,
      interactive: flags.interactive,
      json: flags.json,
      watch: flags.watch,
    })) {
      await launchTuiManager({
        initialProjectId: flags.project,
        refreshMs: integerFlagValues.refreshMs,
        runtime: {
          createCommands: (snapshot) => createTuiCommandSuggestions(snapshot, {commandPrefix: flags['command-prefix']}),
          formatActionResult: formatTuiActionResult,
          readSnapshot: (projectId) => readTuiSnapshot({
            artifactLimit: integerFlagValues.artifactLimit,
            eventLimit: integerFlagValues.eventLimit,
            projectId,
            workspaceDir: flags.workspace,
          }),
          runAction: (request) => runTuiAction(createTuiManagerActionOptions(flags, request, actionFlagValues, integerFlagValues)),
        },
      })
      return
    }

    if (flags.watch) {
      await this.watchDashboard(flags.workspace, flags.project, integerFlagValues.refreshMs, options)
      return
    }

    let actionResult = await runTuiAction(createTuiActionOptions(flags, {
      action,
      artifactName: flags.artifact,
      dryRun: flags['dry-run'],
      projectId: flags.project,
    }, actionFlagValues, integerFlagValues))
    const snapshot = await readTuiSnapshot({
      artifactLimit: integerFlagValues.artifactLimit,
      eventLimit: integerFlagValues.eventLimit,
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

interface TuiManagerLaunchCheck {
  action: TuiAction
  interactive: boolean
  json: boolean
  watch: boolean
}

function shouldLaunchInteractiveTui(options: TuiManagerLaunchCheck): boolean {
  return options.interactive
    && options.action === 'dashboard'
    && !options.json
    && !options.watch
    && process.stdin.isTTY === true
    && process.stdout.isTTY === true
    && process.env.CI !== 'true'
}

interface ParsedTuiFlags {
  'artifact-limit': number
  artifact?: string
  'command-prefix': string
  'dry-run'?: boolean
  'event-kind'?: string
  'event-limit': number
  'event-provider-role'?: string
  'event-provider-status'?: string
  'event-stage'?: string
  'event-type'?: string
  'export-clean-output'?: boolean
  'export-format'?: string
  'export-output'?: string
  'export-require-quality': boolean
  frame?: string
  limit?: number
  'max-attempts'?: number
  media?: string
  'order-by'?: string
  project?: string
  'quality-details'?: boolean
  'refresh-ms': number
  'render-audio'?: boolean
  'render-audio-ducking'?: boolean
  'render-ducking-attack-ms'?: number
  'render-ducking-ratio'?: number
  'render-ducking-release-ms'?: number
  'render-ducking-threshold'?: string
  'render-output'?: string
  'render-source-volume'?: string
  'render-subtitles'?: boolean
  'render-voiceover-volume'?: string
  'running-stale-after-ms'?: number
  text?: string
  'visual-include-content'?: boolean
  workspace: string
}

interface TuiActionFlagValues {
  eventKind?: ProjectEventKind
  eventPipelineType?: PipelineEventType
  eventProviderRole?: ProviderCallRole
  eventProviderStatus?: ProviderCallStatus
  exportFormat?: ExportFormat
  fromStage?: FilmPipelineStage
  orderBy?: FilmRecoveryOrderBy
  providerRole: ProviderSmokeTestRoleOption
  renderDuckingThreshold?: number
  renderSourceVolume?: number
  renderVoiceoverVolume?: number
  status: FilmRecoveryStatusOption
}

interface TuiIntegerFlagValues {
  artifactLimit: number
  eventLimit: number
  limit?: number
  maxAttempts?: number
  refreshMs: number
  renderDuckingAttackMs?: number
  renderDuckingRatio?: number
  renderDuckingReleaseMs?: number
  runningStaleAfterMs?: number
}

type TuiActionFlagInputs = ParsedTuiFlags & {
  'from-stage'?: string
  'provider-role': string
  status: string
}

function parseTuiActionFlagValues(flags: TuiActionFlagInputs): TuiActionFlagValues {
  return {
    eventKind: parseOptionalEnumFlag<ProjectEventKind>(flags['event-kind'], PROJECT_EVENT_KINDS, '--event-kind'),
    eventPipelineType: parseOptionalEnumFlag<PipelineEventType>(flags['event-type'], PIPELINE_EVENT_TYPES, '--event-type'),
    eventProviderRole: parseOptionalEnumFlag<ProviderCallRole>(flags['event-provider-role'], PROVIDER_CALL_ROLES, '--event-provider-role'),
    eventProviderStatus: parseOptionalEnumFlag<ProviderCallStatus>(flags['event-provider-status'], PROVIDER_CALL_STATUSES, '--event-provider-status'),
    exportFormat: parseOptionalEnumFlag<ExportFormat>(flags['export-format'], EXPORT_FORMATS, '--export-format'),
    fromStage: parseOptionalEnumFlag<FilmPipelineStage>(flags['from-stage'], FILM_PIPELINE_STAGES, '--from-stage'),
    orderBy: parseOptionalEnumFlag<FilmRecoveryOrderBy>(flags['order-by'], FILM_RECOVERY_ORDER_BY_VALUES, '--order-by'),
    providerRole: parseRequiredEnumFlag<ProviderSmokeTestRoleOption>(flags['provider-role'], PROVIDER_SMOKE_TEST_ROLE_OPTIONS, '--provider-role'),
    renderDuckingThreshold: parseOptionalNumberFlag(flags['render-ducking-threshold'], '--render-ducking-threshold'),
    renderSourceVolume: parseOptionalNumberFlag(flags['render-source-volume'], '--render-source-volume'),
    renderVoiceoverVolume: parseOptionalNumberFlag(flags['render-voiceover-volume'], '--render-voiceover-volume'),
    status: parseRequiredEnumFlag<FilmRecoveryStatusOption>(flags.status, FILM_RECOVERY_STATUS_OPTIONS, '--status'),
  }
}

function parseTuiIntegerFlagValues(flags: ParsedTuiFlags): TuiIntegerFlagValues {
  return {
    artifactLimit: normalizeRequiredNonNegativeIntegerFlag(flags['artifact-limit'], '--artifact-limit'),
    eventLimit: normalizeRequiredNonNegativeIntegerFlag(flags['event-limit'], '--event-limit'),
    limit: normalizeNonNegativeIntegerFlag(flags.limit, '--limit'),
    maxAttempts: normalizeNonNegativeIntegerFlag(flags['max-attempts'], '--max-attempts'),
    refreshMs: normalizeRequiredPositiveIntegerFlag(flags['refresh-ms'], '--refresh-ms'),
    renderDuckingAttackMs: normalizeNonNegativeIntegerFlag(flags['render-ducking-attack-ms'], '--render-ducking-attack-ms'),
    renderDuckingRatio: normalizePositiveIntegerFlag(flags['render-ducking-ratio'], '--render-ducking-ratio'),
    renderDuckingReleaseMs: normalizeNonNegativeIntegerFlag(flags['render-ducking-release-ms'], '--render-ducking-release-ms'),
    runningStaleAfterMs: normalizeNonNegativeIntegerFlag(flags['running-stale-after-ms'], '--running-stale-after-ms'),
  }
}

interface TuiActionContext {
  action: TuiAction
  artifactName?: string
  dryRun?: boolean
  projectId?: string
}

function createTuiActionOptions(flags: ParsedTuiFlags, context: TuiActionContext, actionFlagValues: TuiActionFlagValues, integerFlagValues: TuiIntegerFlagValues): RunTuiActionOptions {
  return {
    action: context.action,
    artifactLimit: integerFlagValues.artifactLimit,
    artifactName: context.artifactName,
    commandPrefix: flags['command-prefix'],
    dryRun: context.dryRun,
    eventKind: actionFlagValues.eventKind,
    eventLimit: integerFlagValues.eventLimit,
    eventPipelineStage: flags['event-stage'],
    eventPipelineType: actionFlagValues.eventPipelineType,
    eventProviderRole: actionFlagValues.eventProviderRole,
    eventProviderStatus: actionFlagValues.eventProviderStatus,
    exportCleanOutput: flags['export-clean-output'],
    exportFormat: actionFlagValues.exportFormat,
    exportOutputPath: flags['export-output'],
    exportRequireQuality: flags['export-require-quality'],
    framePath: flags.frame,
    fromStage: actionFlagValues.fromStage,
    limit: integerFlagValues.limit,
    maxAttempts: integerFlagValues.maxAttempts,
    mediaPath: flags.media,
    orderBy: actionFlagValues.orderBy,
    projectId: context.projectId,
    providerRole: actionFlagValues.providerRole,
    qualityDetails: flags['quality-details'],
    renderAudio: flags['render-audio'],
    renderAudioDucking: flags['render-audio-ducking'],
    renderDuckingAttackMs: integerFlagValues.renderDuckingAttackMs,
    renderDuckingRatio: integerFlagValues.renderDuckingRatio,
    renderDuckingReleaseMs: integerFlagValues.renderDuckingReleaseMs,
    renderDuckingThreshold: actionFlagValues.renderDuckingThreshold,
    renderOutputPath: flags['render-output'],
    renderSourceVolume: actionFlagValues.renderSourceVolume,
    renderSubtitles: flags['render-subtitles'],
    renderVoiceoverVolume: actionFlagValues.renderVoiceoverVolume,
    runningStaleAfterMs: integerFlagValues.runningStaleAfterMs,
    status: actionFlagValues.status,
    text: flags.text,
    visualIncludeContent: flags['visual-include-content'],
    workspaceDir: flags.workspace,
  }
}

function createTuiManagerActionOptions(flags: ParsedTuiFlags, request: TuiManagerActionRequest, actionFlagValues: TuiActionFlagValues, integerFlagValues: TuiIntegerFlagValues): RunTuiActionOptions {
  const action: TuiAction = request.id === 'worker-dry-run' ? 'worker' : request.id

  return createTuiActionOptions(flags, {
    action,
    artifactName: request.artifactName ?? flags.artifact,
    dryRun: request.id === 'worker-dry-run' ? true : flags['dry-run'],
    projectId: request.projectId ?? flags.project,
  }, actionFlagValues, integerFlagValues)
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

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
