import {Args, Command, Flags} from '@oclif/core'
import {inspectFfmpegAudio, type ProjectRenderer, renderProject} from '@video-agent/runtime'

export default class Render extends Command {
  static args = {
    project: Args.string({description: 'Project id to render', required: true}),
  }
  static description = 'Render a project timeline with ffmpeg or HyperFrames'
  static flags = {
    audio: Flags.boolean({allowNo: true, default: true, description: 'Mix available source audio and TTS voiceover segments'}),
    'audio-ducking': Flags.boolean({default: false, description: 'Use voiceover sidechain compression to duck source audio'}),
    'ducking-attack-ms': Flags.integer({description: 'Audio ducking compressor attack in milliseconds'}),
    'ducking-ratio': Flags.integer({description: 'Audio ducking compressor ratio'}),
    'ducking-release-ms': Flags.integer({description: 'Audio ducking compressor release in milliseconds'}),
    'ducking-threshold': Flags.string({description: 'Audio ducking compressor threshold'}),
    'hyperframes-command': Flags.string({description: 'HyperFrames command prefix, either a binary name or JSON string array'}),
    'hyperframes-output': Flags.string({description: 'Output path for HyperFrames CLI render'}),
    'hyperframes-render': Flags.boolean({default: false, description: 'Run HyperFrames CLI render after project generation'}),
    'hyperframes-validate': Flags.boolean({default: false, description: 'Run HyperFrames CLI validate after project generation'}),
    'inspect-audio': Flags.boolean({description: 'Inspect ffmpeg audio inputs and voiceover alignment without rendering'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    output: Flags.string({description: 'Output video path or HyperFrames project directory'}),
    renderer: Flags.string({description: 'Renderer to use. Omit to auto-select from project artifacts.', options: ['ffmpeg', 'hyperframes']}),
    'source-volume': Flags.string({description: 'Source audio volume multiplier'}),
    subtitles: Flags.boolean({allowNo: true, default: true, description: 'Burn narration subtitles when narration.json exists'}),
    'voiceover-volume': Flags.string({description: 'Voiceover audio volume multiplier'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Render)
    const options = {
      audio: flags.audio,
      audioDucking: flags['audio-ducking'],
      duckingAttackMs: flags['ducking-attack-ms'],
      duckingRatio: flags['ducking-ratio'],
      duckingReleaseMs: flags['ducking-release-ms'],
      duckingThreshold: parseOptionalNumber(flags['ducking-threshold'], 'ducking-threshold'),
      hyperframesCommand: parseCommandPrefix(flags['hyperframes-command']),
      hyperframesOutput: flags['hyperframes-output'],
      hyperframesRender: flags['hyperframes-render'],
      hyperframesValidate: flags['hyperframes-validate'],
      output: flags.output,
      renderer: flags.renderer as ProjectRenderer | undefined,
      sourceVolume: parseOptionalNumber(flags['source-volume'], 'source-volume'),
      subtitles: flags.subtitles,
      voiceoverVolume: parseOptionalNumber(flags['voiceover-volume'], 'voiceover-volume'),
      workspaceDir: flags.workspace,
    }

    if (flags['inspect-audio']) {
      const diagnostics = await inspectFfmpegAudio(args.project, options)

      if (flags.json) {
        this.log(JSON.stringify(diagnostics, null, 2))
        return
      }

      this.log(`Available voiceovers: ${diagnostics.availableVoiceovers}`)
      this.log(`Missing voiceovers: ${diagnostics.missingVoiceovers.length}`)

      for (const warning of diagnostics.warnings) {
        this.log(`Audio warning: ${warning}`)
      }

      for (const voiceover of diagnostics.plan.segments) {
        this.log(`Voiceover: ${voiceover.narrationId ?? `index ${voiceover.index}`}\t${voiceover.status}\tstart=${voiceover.start}`)
      }

      return
    }

    const output = await renderProject(args.project, options)

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Artifact: ${output.artifactPath}`)

    if (output.renderer === 'ffmpeg') {
      this.log(`Output: ${output.outputPath}`)
      this.log(`Audio inputs: ${output.audioInputs}`)
      this.log(`Subtitles: ${output.subtitlePath ?? 'none'}`)

      for (const warning of output.audioDiagnostics.warnings) {
        this.log(`Audio warning: ${warning}`)
      }

      for (const voiceover of output.audioDiagnostics.missingVoiceovers) {
        this.log(`Missing voiceover: ${voiceover.narrationId ?? `index ${voiceover.index}`} (${voiceover.reason})`)
      }

      return
    }

    this.log(`Output: ${output.outputDir}`)
    this.log(`Entry: ${output.entryHtml}`)
    this.log(`Validated: ${output.validation === undefined ? 'no' : 'yes'}`)
    this.log(`Rendered: ${output.rendered === undefined ? 'no' : 'yes'}`)
  }
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
