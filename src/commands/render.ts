import {Args, Command, Flags} from '@oclif/core'
import {inspectFfmpegAudio, renderProject} from '@video-agent/runtime'

export default class Render extends Command {
  static args = {
    project: Args.string({description: 'Project id to render', required: true}),
  }
  static description = 'Render a project timeline with ffmpeg'
  static flags = {
    audio: Flags.boolean({allowNo: true, default: true, description: 'Mix available source audio and TTS voiceover segments'}),
    'audio-ducking': Flags.boolean({default: false, description: 'Use voiceover sidechain compression to duck source audio'}),
    'ducking-attack-ms': Flags.integer({description: 'Audio ducking compressor attack in milliseconds'}),
    'ducking-ratio': Flags.integer({description: 'Audio ducking compressor ratio'}),
    'ducking-release-ms': Flags.integer({description: 'Audio ducking compressor release in milliseconds'}),
    'ducking-threshold': Flags.string({description: 'Audio ducking compressor threshold'}),
    'inspect-audio': Flags.boolean({description: 'Inspect ffmpeg audio inputs and voiceover alignment without rendering'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    output: Flags.string({description: 'Output video path'}),
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
      output: flags.output,
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

    this.log(`Output: ${output.outputPath}`)
    this.log(`Audio inputs: ${output.audioInputs}`)
    this.log(`Subtitles: ${output.subtitlePath ?? 'none'}`)

    for (const warning of output.audioDiagnostics.warnings) {
      this.log(`Audio warning: ${warning}`)
    }

    for (const voiceover of output.audioDiagnostics.missingVoiceovers) {
      this.log(`Missing voiceover: ${voiceover.narrationId ?? `index ${voiceover.index}`} (${voiceover.reason})`)
    }
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
