import {Args, Command, Flags} from '@oclif/core'
import {createDeckFinalRenderProject, createDeckFrameShardBatchProject, createDeckFrameShardPlanProject} from '@video-agent/pipeline-deck'

export default class DeckRender extends Command {
  static args = {
    projectId: Args.string({description: 'Deck Explainer project id with timed-deck.json and deck voiceover audio', required: true}),
  }

  static description = 'Render the final Deck Explainer video from timed DeckIR and voiceover audio'

  static flags = {
    'chromium-command': Flags.string({description: 'Chromium command prefix for HTML frame capture, either a binary name or JSON string array'}),
    finalize: Flags.boolean({default: false, description: 'Finalize video after a frame range capture when all frames are available'}),
    'finalize-only': Flags.boolean({default: false, description: 'Finalize video from the existing complete frame sequence without running Chromium capture'}),
    'frame-capture-backend': Flags.string({default: 'chromium', description: 'Browser backend for full frame sequence capture', options: ['chromium', 'playwright']}),
    'frame-concurrency': Flags.integer({description: 'Maximum Chromium screenshot captures to run concurrently', default: 1}),
    'frame-end': Flags.integer({description: 'Last 1-based frame number to capture for a frame shard'}),
    'frame-shard-size': Flags.integer({description: 'Frame count per planned shard when using --plan-shards'}),
    'frame-start': Flags.integer({description: 'First 1-based frame number to capture for a frame shard'}),
    'html-output': Flags.string({description: 'Output path for optional HTML renderer capture'}),
    'html-render': Flags.boolean({default: false, description: 'Run an external HTML renderer such as HyperFrames against renders/html'}),
    'html-render-command': Flags.string({description: 'HTML renderer command prefix, either a binary name or JSON string array'}),
    'html-validate': Flags.boolean({default: false, description: 'Run external HTML renderer validation against renders/html'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'keyframe-capture-backend': Flags.string({default: 'chromium', description: 'Browser backend for independent keyframe visual QC', options: ['chromium', 'playwright']}),
    'plan-shards': Flags.boolean({default: false, description: 'Write a frame shard plan and full frame manifest without rendering frames'}),
    'playwright-command': Flags.string({description: 'Playwright keyframe capture command prefix, either a binary name or JSON string array'}),
    'run-shards': Flags.boolean({default: false, description: 'Capture all frame shards locally with bounded shard concurrency, then write a resumable shard batch artifact'}),
    'shard-concurrency': Flags.integer({description: 'Maximum frame shards to capture concurrently when using --run-shards', default: 1}),
    'shard-retries': Flags.integer({description: 'Retry count for each failed frame shard when using --run-shards', default: 0}),
    'shard-retry-delay-ms': Flags.integer({description: 'Delay between shard retry attempts in milliseconds when using --run-shards', default: 0}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(DeckRender)

    if (flags['plan-shards']) {
      const output = await createDeckFrameShardPlanProject({
        frameCaptureBackend: flags['frame-capture-backend'] as 'chromium' | 'playwright',
        frameShardSize: normalizePositiveInteger(flags['frame-shard-size'], '--frame-shard-size'),
        projectId: args.projectId,
        workspaceDir: flags.workspace,
      })

      if (flags.json) {
        this.log(JSON.stringify(output, null, 2))
        return
      }

      this.log(`Project: ${output.projectId}`)
      this.log(`Workspace: ${output.projectDir}`)
      this.log(`Status: ${output.status}`)
      this.log(`Frame capture backend: ${flags['frame-capture-backend']}`)
      this.log(`Frame shard size: ${output.frameShardSize}`)
      this.log(`Frame count: ${output.frameCount}`)
      this.log(`Shards: ${output.shardCount}`)
      this.log(`Shard status: ${output.completeShards} complete, ${output.partialShards} partial, ${output.pendingShards} pending`)
      this.log(`Finalize args: ${output.finalizeArgs.join(' ')}`)
      this.log(`Shard plan: ${output.artifactPath}`)
      return
    }

    if (flags['run-shards']) {
      const output = await createDeckFrameShardBatchProject({
        chromiumCommand: parseCommandPrefix(flags['chromium-command'], '--chromium-command'),
        frameCaptureBackend: flags['frame-capture-backend'] as 'chromium' | 'playwright',
        frameConcurrency: normalizePositiveInteger(flags['frame-concurrency'], '--frame-concurrency'),
        frameShardSize: normalizePositiveInteger(flags['frame-shard-size'], '--frame-shard-size'),
        playwrightCommand: parseCommandPrefix(flags['playwright-command'], '--playwright-command'),
        projectId: args.projectId,
        shardConcurrency: normalizePositiveInteger(flags['shard-concurrency'], '--shard-concurrency'),
        shardRetryDelayMs: normalizeNonNegativeInteger(flags['shard-retry-delay-ms'], '--shard-retry-delay-ms'),
        shardRetries: normalizeNonNegativeInteger(flags['shard-retries'], '--shard-retries'),
        workspaceDir: flags.workspace,
      })

      if (flags.json) {
        this.log(JSON.stringify(output, null, 2))
        return
      }

      this.log(`Project: ${output.projectId}`)
      this.log(`Workspace: ${output.projectDir}`)
      this.log(`Status: ${output.status}`)
      this.log(`Frame capture backend: ${output.renderer}`)
      this.log(`Frame concurrency: ${output.frameConcurrency}`)
      this.log(`Shard concurrency: ${output.shardConcurrency}`)
      this.log(`Shard retries: ${output.shardRetries}`)
      this.log(`Frame shard size: ${output.frameShardSize}`)
      this.log(`Frame count: ${output.frameCount}`)
      this.log(`Shards: ${output.completedShards} complete, ${output.failedShards} failed`)
      this.log(`Finalize args: deck render ${output.projectId} --finalize-only`)
      this.log(`Shard batch: ${output.artifactPath}`)
      return
    }

    const output = await createDeckFinalRenderProject({
      chromiumCommand: parseCommandPrefix(flags['chromium-command'], '--chromium-command'),
      finalize: flags.finalize,
      finalizeOnly: flags['finalize-only'],
      frameCaptureBackend: flags['frame-capture-backend'] as 'chromium' | 'playwright',
      frameConcurrency: normalizePositiveInteger(flags['frame-concurrency'], '--frame-concurrency'),
      frameEnd: normalizePositiveInteger(flags['frame-end'], '--frame-end'),
      frameStart: normalizePositiveInteger(flags['frame-start'], '--frame-start'),
      htmlOutput: flags['html-output'],
      htmlRender: flags['html-render'],
      htmlRenderCommand: parseCommandPrefix(flags['html-render-command'], '--html-render-command'),
      htmlValidate: flags['html-validate'],
      keyframeCaptureBackend: flags['keyframe-capture-backend'] as 'chromium' | 'playwright',
      playwrightCommand: parseCommandPrefix(flags['playwright-command'], '--playwright-command'),
      projectId: args.projectId,
      workspaceDir: flags.workspace,
    })

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Workspace: ${output.projectDir}`)
    this.log(`Status: ${output.status}`)
    this.log(`Finalized: ${output.finalized ? 'yes' : 'no'}`)
    this.log(`Renderer: ${output.renderer}`)
    this.log(`Frame renderer: ${output.frameRenderer}`)
    this.log(`Frame concurrency: ${normalizePositiveInteger(flags['frame-concurrency'], '--frame-concurrency')}`)
    this.log(`Video renderer: ${output.videoRenderer}`)
    this.log(`HTML entry: ${output.htmlEntryPath}`)
    this.log(`HTML validated: ${output.validation === undefined ? 'no' : 'yes'}`)
    this.log(`HTML rendered: ${output.rendered === undefined ? 'no' : 'yes'}`)
    this.log(`Keyframe renderer: ${output.keyframeRenderer ?? 'not finalized'}`)
    this.log(`Frame range: ${output.frameStart}-${output.frameEnd}`)
    this.log(`Final video: ${output.finalized ? output.outputPath : 'not finalized'}`)
    this.log(`${output.finalized ? 'Render output' : 'Shard output'}: ${output.artifactPath}`)
  }
}

function normalizeNonNegativeInteger(value: number | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isFinite(value) || value < 0 || Math.floor(value) !== value) {
    throw new TypeError(`${flagName} must be a non-negative integer.`)
  }

  return value
}

function normalizePositiveInteger(value: number | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isFinite(value) || value < 1 || Math.floor(value) !== value) {
    throw new TypeError(`${flagName} must be a positive integer.`)
  }

  return value
}

function parseCommandPrefix(value: string | undefined, flagName: string): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  const trimmed = value.trim()

  if (trimmed === '') {
    throw new TypeError(`${flagName} must not be empty.`)
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown

    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || item.length === 0)) {
      throw new TypeError(`${flagName} JSON value must be an array of non-empty strings.`)
    }

    return parsed
  }

  return [trimmed]
}
