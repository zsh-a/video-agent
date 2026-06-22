import {Args, Command, Flags} from '@oclif/core'
import {runFilmRecapPipeline} from '@video-agent/pipeline-film'
import {resolve} from 'node:path'

import {normalizePositiveIntegerFlag, parseDurationSeconds, workspaceFlag} from '../utils/cli-flags.js'

export default class Film extends Command {
  static args = {
    input: Args.string({description: 'Input video file for the Film Recap pipeline', required: true}),
  }

  static description = 'Run the Film Recap pipeline from source video to final recap render'

  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'max-scenes': Flags.integer({description: 'Maximum visual/silence-backed source scenes to derive during film understanding'}),
    'project-id': Flags.string({description: 'Project id to use for the workspace'}),
    target: Flags.string({description: 'Target duration hint for later clip planning'}),
    trace: Flags.boolean({description: 'Write full LLM request/response traces to project artifacts'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Film)
    let output: Awaited<ReturnType<typeof runFilmRecapPipeline>>

    try {
      output = await runFilmRecapPipeline({
        inputPath: resolve(args.input),
        maxScenes: normalizePositiveIntegerFlag(flags['max-scenes'], '--max-scenes'),
        projectId: flags['project-id'],
        targetDurationSeconds: flags.target === undefined ? undefined : parseDurationSeconds(flags.target),
        trace: flags.trace,
        workspaceDir: flags.workspace,
      })
    } catch (error) {
      this.errorToStderr(error)
      process.exitCode = 1
      return
    }

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

  private errorToStderr(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)

    this.error(message === '' ? 'Film Recap pipeline failed.' : message, {exit: false})
  }
}

function formatDimensions(width: number | undefined, height: number | undefined): string {
  if (width === undefined || height === undefined) {
    return 'unknown'
  }

  return `${width}x${height}`
}
