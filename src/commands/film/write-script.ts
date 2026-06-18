import {Args, Command, Flags} from '@oclif/core'
import {createFilmRecapScriptProject} from '@video-agent/pipeline-film'

export default class FilmWriteScript extends Command {
  static args = {
    projectId: Args.string({description: 'Film Recap project id with story-index.json', required: true}),
  }

  static description = 'Write a Film Recap third-person narration script from story beats'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    target: Flags.string({description: 'Target recap duration, such as 10m, 600s, or 00:10:00'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FilmWriteScript)
    const output = await createFilmRecapScriptProject({
      projectId: args.projectId,
      targetDurationSeconds: flags.target === undefined ? undefined : parseDurationSeconds(flags.target),
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Workspace: ${output.projectDir}`)
    this.log(`Status: ${output.status}`)
    this.log(`Segments: ${output.segments}`)
    this.log(`Estimated duration: ${output.totalEstimatedDuration}s`)
    this.log(`Recap script: ${output.artifacts.recapScript}`)
    this.log(`Next: vagent film plan-clips ${output.projectId} --workspace ${flags.workspace}`)
  }
}

function parseDurationSeconds(value: string): number {
  const trimmed = value.trim()
  const unitMatch = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i.exec(trimmed)

  if (unitMatch !== null) {
    const amount = Number(unitMatch[1])
    const unit = unitMatch[2]?.toLowerCase() ?? 's'

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Invalid duration: ${value}`)
    }

    if (unit === 'ms') {
      return amount / 1000
    }

    if (unit === 'm') {
      return amount * 60
    }

    if (unit === 'h') {
      return amount * 3600
    }

    return amount
  }

  const parts = trimmed.split(':').map(Number)

  if (parts.length >= 2 && parts.length <= 3 && parts.every((part) => Number.isFinite(part) && part >= 0)) {
    const seconds = parts.length === 2
      ? parts[0] * 60 + parts[1]
      : parts[0] * 3600 + parts[1] * 60 + parts[2]

    if (seconds > 0) {
      return seconds
    }
  }

  throw new Error(`Invalid duration: ${value}`)
}
