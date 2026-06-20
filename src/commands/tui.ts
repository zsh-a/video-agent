import type {RecoveryOrderBy} from '@video-agent/pipeline-film'
import type {ExportFormat, PipelineStage, ProjectEventKind, ProjectPipelineEventType, ProviderCallRole, ProviderCallStatus} from '@video-agent/runtime'
import type {RunTuiActionOptions} from '../ui/actions/index.js'
import type {FormatTuiSnapshotOptions, TuiAction, TuiCommandSuggestion} from '../ui/model.js'

import {Command, Flags} from '@oclif/core'
import {FILM_PIPELINE_STAGES} from '@video-agent/pipeline-film'
import {createInterface, type Interface} from 'node:readline'

import {readTuiSnapshot, runTuiAction} from '../ui/actions/index.js'
import {createTuiCommandSuggestions, formatTuiActionResult, formatTuiCommandSelector, formatTuiSnapshot, resolveTuiCommandSelection} from '../ui/format/console.js'
import {type TuiManagerActionRequest, launchTuiManager} from '../ui/manager/index.js'

const PIPELINE_EVENT_TYPES = ['agent:run:complete', 'agent:run:fail', 'agent:run:start', 'agent:step:complete', 'agent:step:fail', 'agent:step:progress', 'agent:step:start', 'artifact', 'log', 'stage:complete', 'stage:fail', 'stage:progress', 'stage:retry', 'stage:start', 'tool:call:complete', 'tool:call:fail', 'tool:call:start'] as const

export default class Tui extends Command {
  static description = 'Manage video-agent workspace projects in the terminal'
  static flags = {
    action: Flags.string({default: 'dashboard', description: 'Dashboard action to run before rendering', options: ['artifact', 'audio', 'commands', 'dashboard', 'events', 'export', 'projects', 'provider-test', 'quality', 'render', 'rerun', 'select', 'status', 'verify', 'visual', 'worker']}),
    artifact: Flags.string({description: 'Artifact filename to inspect when --action artifact is used'}),
    'artifact-limit': Flags.integer({default: 8, description: 'Maximum artifacts to show for the selected project'}),
    'command-prefix': Flags.string({default: 'bun run dev', description: 'Command prefix used in TUI command suggestions'}),
    'dry-run': Flags.boolean({description: 'Preview worker recovery when --action worker is used'}),
    'event-kind': Flags.string({description: 'Event kind filter when --action events is used', options: ['pipeline', 'provider']}),
    'event-limit': Flags.integer({default: 6, description: 'Maximum recent events to show for the selected project'}),
    'event-provider-role': Flags.string({description: 'Provider role filter when --action events is used', options: ['asr', 'script', 'tts', 'vlm']}),
    'event-provider-status': Flags.string({description: 'Provider status filter when --action events is used', options: ['failed', 'succeeded']}),
    'event-stage': Flags.string({description: 'Pipeline stage filter when --action events is used'}),
    'event-type': Flags.string({description: 'Pipeline event type filter when --action events is used', options: [...PIPELINE_EVENT_TYPES]}),
    'export-clean-output': Flags.boolean({description: 'Remove an existing directory output before exporting bundle format when --action export is used'}),
    'export-format': Flags.string({description: 'Export format when --action export is used. Omit to infer from the latest render output.', options: ['video', 'bundle']}),
    'export-output': Flags.string({description: 'Output file or directory path when --action export is used'}),
    'export-require-quality': Flags.boolean({allowNo: true, default: true, description: 'Refuse export unless project quality is clean when --action export is used'}),
    frame: Flags.string({description: 'Sample frame path for VLM provider tests'}),
    'from-stage': Flags.string({
      description: 'Stage to start from when --action rerun is used',
      options: [...FILM_PIPELINE_STAGES],
    }),
    interactive: Flags.boolean({allowNo: true, default: true, description: 'Use the interactive Ink manager when a TTY is available'}),
    json: Flags.boolean({description: 'Print machine-readable dashboard snapshot'}),
    limit: Flags.integer({description: 'Maximum recoverable jobs to process when --action worker is used'}),
    'max-attempts': Flags.integer({description: 'Skip jobs whose recovery stage attempt is greater than or equal to this value when --action worker is used'}),
    media: Flags.string({description: 'Sample media path for ASR provider tests'}),
    'order-by': Flags.string({description: 'Recovery candidate ordering when --action worker is used', options: ['attempt', 'oldest', 'recent']}),
    project: Flags.string({description: 'Project id to focus; defaults to the most recently updated project'}),
    'provider-role': Flags.string({default: 'all', description: 'Provider role to test when --action provider-test is used', options: ['all', 'asr', 'tts', 'vlm']}),
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

    if (shouldLaunchInteractiveTui({
      action,
      interactive: flags.interactive,
      json: flags.json,
      watch: flags.watch,
    })) {
      await launchTuiManager({
        initialProjectId: flags.project,
        refreshMs: flags['refresh-ms'],
        runtime: {
          createCommands: (snapshot) => createTuiCommandSuggestions(snapshot, {commandPrefix: flags['command-prefix']}),
          formatActionResult: formatTuiActionResult,
          readSnapshot: (projectId) => readTuiSnapshot({
            artifactLimit: flags['artifact-limit'],
            eventLimit: flags['event-limit'],
            projectId,
            workspaceDir: flags.workspace,
          }),
          runAction: (request) => runTuiAction(createTuiManagerActionOptions(flags, request)),
        },
      })
      return
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
      eventKind: flags['event-kind'] as ProjectEventKind | undefined,
      eventLimit: flags['event-limit'],
      eventPipelineStage: flags['event-stage'],
      eventPipelineType: flags['event-type'] as ProjectPipelineEventType | undefined,
      eventProviderRole: flags['event-provider-role'] as ProviderCallRole | undefined,
      eventProviderStatus: flags['event-provider-status'] as ProviderCallStatus | undefined,
      exportCleanOutput: flags['export-clean-output'],
      exportFormat: flags['export-format'] as ExportFormat | undefined,
      exportOutputPath: flags['export-output'],
      exportRequireQuality: flags['export-require-quality'],
      framePath: flags.frame,
      fromStage: flags['from-stage'] as PipelineStage | undefined,
      limit: flags.limit,
      maxAttempts: flags['max-attempts'],
      mediaPath: flags.media,
      orderBy: flags['order-by'] as RecoveryOrderBy | undefined,
      projectId: flags.project,
      providerRole: flags['provider-role'],
      qualityDetails: flags['quality-details'],
      renderAudio: flags['render-audio'],
      renderAudioDucking: flags['render-audio-ducking'],
      renderDuckingAttackMs: flags['render-ducking-attack-ms'],
      renderDuckingRatio: flags['render-ducking-ratio'],
      renderDuckingReleaseMs: flags['render-ducking-release-ms'],
      renderDuckingThreshold: parseOptionalNumber(flags['render-ducking-threshold'], 'render-ducking-threshold'),
      renderOutputPath: flags['render-output'],
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
  'from-stage'?: string
  limit?: number
  'max-attempts'?: number
  media?: string
  'order-by'?: string
  project?: string
  'provider-role': string
  'quality-details'?: boolean
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
  status: string
  text?: string
  'visual-include-content'?: boolean
  workspace: string
}

function createTuiManagerActionOptions(flags: ParsedTuiFlags, request: TuiManagerActionRequest): RunTuiActionOptions {
  const action = request.id === 'worker-dry-run' ? 'worker' : request.id

  return {
    action,
    artifactLimit: flags['artifact-limit'],
    artifactName: request.artifactName ?? flags.artifact,
    commandPrefix: flags['command-prefix'],
    dryRun: request.id === 'worker-dry-run' ? true : flags['dry-run'],
    eventKind: flags['event-kind'] as ProjectEventKind | undefined,
    eventLimit: flags['event-limit'],
    eventPipelineStage: flags['event-stage'],
    eventPipelineType: flags['event-type'] as ProjectPipelineEventType | undefined,
    eventProviderRole: flags['event-provider-role'] as ProviderCallRole | undefined,
    eventProviderStatus: flags['event-provider-status'] as ProviderCallStatus | undefined,
    exportCleanOutput: flags['export-clean-output'],
    exportFormat: flags['export-format'] as ExportFormat | undefined,
    exportOutputPath: flags['export-output'],
    exportRequireQuality: flags['export-require-quality'],
    framePath: flags.frame,
    fromStage: flags['from-stage'] as PipelineStage | undefined,
    limit: flags.limit,
    maxAttempts: flags['max-attempts'],
    mediaPath: flags.media,
    orderBy: flags['order-by'] as RecoveryOrderBy | undefined,
    projectId: request.projectId ?? flags.project,
    providerRole: flags['provider-role'],
    qualityDetails: flags['quality-details'],
    renderAudio: flags['render-audio'],
    renderAudioDucking: flags['render-audio-ducking'],
    renderDuckingAttackMs: flags['render-ducking-attack-ms'],
    renderDuckingRatio: flags['render-ducking-ratio'],
    renderDuckingReleaseMs: flags['render-ducking-release-ms'],
    renderDuckingThreshold: parseOptionalNumber(flags['render-ducking-threshold'], 'render-ducking-threshold'),
    renderOutputPath: flags['render-output'],
    renderSourceVolume: parseOptionalNumber(flags['render-source-volume'], 'render-source-volume'),
    renderSubtitles: flags['render-subtitles'],
    renderVoiceoverVolume: parseOptionalNumber(flags['render-voiceover-volume'], 'render-voiceover-volume'),
    runningStaleAfterMs: flags['running-stale-after-ms'],
    status: flags.status,
    text: flags.text,
    visualIncludeContent: flags['visual-include-content'],
    workspaceDir: flags.workspace,
  }
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
