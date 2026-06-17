import {Args, Command, Flags} from '@oclif/core'
import {runFilmRecapPipeline} from '@video-agent/pipeline-film'
import {resolve} from 'node:path'

export default class Film extends Command {
  static args = {
    input: Args.string({description: 'Input video file for the Film Recap pipeline', required: true}),
  }

  static description = 'Run the Film Recap pipeline from source video to final recap render'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'max-scenes': Flags.integer({description: 'Maximum source scenes to derive during film understanding'}),
    'project-id': Flags.string({description: 'Project id to use for the workspace'}),
    target: Flags.string({description: 'Target duration hint for later clip planning'}),
    trace: Flags.boolean({description: 'Write full LLM request/response traces to project artifacts'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Film)
    const output = await runFilmRecapPipeline({
      inputPath: resolve(args.input),
      maxScenes: flags['max-scenes'],
      projectId: flags['project-id'],
      targetDurationSeconds: flags.target === undefined ? undefined : parseDurationSeconds(flags.target),
      trace: flags.trace,
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Workspace: ${output.projectDir}`)
    this.log(`Status: ${output.status}`)
    this.log(`Duration: ${output.ingest.sourceManifest.duration}s`)
    this.log(`Video: ${formatDimensions(output.ingest.sourceManifest.width, output.ingest.sourceManifest.height)} ${output.ingest.sourceManifest.orientation}`)
    this.log(`Clips: ${output.clipPlan.clips}`)
    this.log(`Final: ${output.finalRender.outputPath}`)
    this.log(`Quality errors: ${output.quality.qualityReport.summary.errors}`)
  }
}

function formatDimensions(width: number | undefined, height: number | undefined): string {
  if (width === undefined || height === undefined) {
    return 'unknown'
  }

  return `${width}x${height}`
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
