import type {DeckContentDensity, DeckFormat, Document} from '@video-agent/ir'

import {Args, Command, Flags} from '@oclif/core'
import {runDeckExplainerPipeline} from '@video-agent/pipeline-deck'
import {resolve} from 'node:path'

type DeckFormatFlag = 'landscape' | 'portrait' | 'square'
type DeckModeFlag = 'audio-anchored' | 'script-generated' | 'summarize'
type DeckSourceTypeFlag = Exclude<Document['source']['sourceType'], 'audio'>

export default class Deck extends Command {
  static args = {
    input: Args.string({description: 'Input text or markdown file to convert into a PPT-style explainer video project', required: true}),
  }

  static description = 'Run the Deck Explainer pipeline from content to final slide video'

  static flags = {
    'chromium-command': Flags.string({description: 'Chromium command prefix for HTML frame capture, either a binary name or JSON string array'}),
    'content-density': Flags.string({default: 'balanced', description: 'Generated deck content density', options: ['concise', 'balanced', 'detailed']}),
    duration: Flags.string({description: 'Target deck duration, such as 180s, 3m, or 00:03:00'}),
    'frame-capture-backend': Flags.string({default: 'playwright', description: 'Browser backend for full frame sequence capture', options: ['chromium', 'playwright']}),
    'frame-concurrency': Flags.integer({description: 'Maximum browser screenshot captures to run concurrently', default: 1}),
    format: Flags.string({
      default: 'portrait',
      description: 'Output slide format',
      options: ['landscape', 'portrait', 'square'],
    }),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'keyframe-capture-backend': Flags.string({default: 'playwright', description: 'Browser backend for independent keyframe visual QC', options: ['chromium', 'playwright']}),
	    language: Flags.string({description: 'Narration/deck language tag; omit to let the LLM choose from the source'}),
    'max-slide-characters': Flags.integer({description: 'Maximum characters per generated slide', default: 260}),
    mode: Flags.string({
      description: 'Deck generation mode; required so the CLI does not infer script-generated, summarize, or audio-anchored behavior',
      options: ['script-generated', 'summarize', 'audio-anchored'],
    }),
    'project-id': Flags.string({description: 'Project id to use for the workspace'}),
    'playwright-command': Flags.string({description: 'Playwright capture command prefix, either a binary name or JSON string array'}),
    renderer: Flags.string({default: 'remotion', description: 'Deck video renderer', options: ['remotion', 'html']}),
    'max-slides': Flags.integer({description: 'Maximum generated slide count; must be between required slide minimum and the runtime cap'}),
    'slide-count': Flags.integer({description: 'Exact generated slide count target'}),
    'source-type': Flags.string({description: 'Required input source type for script-generated Deck planning; no extension-based inference is performed', options: ['html', 'markdown', 'pdf', 'text']}),
    style: Flags.string({
      description: 'Deck theme/style name (auto lets LLM choose based on content)',
      options: ['auto', 'elegant-dark', 'clean-white', 'finance-terminal', 'tech-gradient', 'minimal-editorial', 'warm-paper'],
    }),
    title: Flags.string({description: 'Title to use for the first slide and DeckIR'}),
    trace: Flags.boolean({description: 'Write full LLM request/response traces to project artifacts'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Deck)

    let output: Awaited<ReturnType<typeof runDeckExplainerPipeline>>

    try {
      const mode = requireDeckCliMode(flags.mode as DeckModeFlag | undefined)
      const slideCountTarget = normalizePositiveInteger(flags['slide-count'], '--slide-count')
      const slideCountMax = normalizePositiveInteger(flags['max-slides'], '--max-slides')

      validateSlideCountFlags(slideCountTarget, slideCountMax)

      output = await runDeckExplainerPipeline({
        chromiumCommand: parseCommandPrefix(flags['chromium-command'], '--chromium-command'),
        contentDensity: flags['content-density'] as DeckContentDensity,
        deckFormat: mapDeckFormat(flags.format as DeckFormatFlag),
        durationTargetSeconds: flags.duration === undefined ? undefined : parseDurationSeconds(flags.duration),
        frameCaptureBackend: flags['frame-capture-backend'] as 'chromium' | 'playwright',
        frameConcurrency: normalizePositiveInteger(flags['frame-concurrency'], '--frame-concurrency'),
        inputPath: resolve(args.input),
        keyframeCaptureBackend: flags['keyframe-capture-backend'] as 'chromium' | 'playwright',
        language: flags.language,
        maxSlideCharacters: flags['max-slide-characters'],
        mode,
        playwrightCommand: parseCommandPrefix(flags['playwright-command'], '--playwright-command'),
        projectId: flags['project-id'],
        renderer: flags.renderer as 'html' | 'remotion',
        slideCountMax,
        slideCountTarget,
        sourceType: flags['source-type'] as DeckSourceTypeFlag | undefined,
        theme: flags.style,
        title: flags.title,
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
    this.log(`Slides: ${output.deck.slides}`)
    this.log(`Status: ${output.status}`)
    if (output.finalRender.htmlEntryPath !== undefined) {
      this.log(`HTML: ${output.finalRender.htmlEntryPath}`)
    }
    this.log(`Renderer: ${output.finalRender.renderer}`)
    this.log(`Final: ${output.finalRender.outputPath}`)
  }

  private errorToStderr(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)

    this.error(message === '' ? 'Deck pipeline failed.' : message, {exit: false})
  }
}

function requireDeckCliMode(mode: DeckModeFlag | undefined): DeckModeFlag {
  if (mode === undefined) {
    throw new Error('Deck command requires --mode; no CLI script-generated fallback is allowed.')
  }

  return mode
}

function normalizePositiveInteger(value: number | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isFinite(value) || value < 1 || Math.floor(value) !== value) {
    throw new Error(`${flagName} must be a positive integer.`)
  }

  return value
}

function validateSlideCountFlags(slideCountTarget: number | undefined, slideCountMax: number | undefined): void {
  if (slideCountTarget !== undefined && slideCountMax !== undefined && slideCountTarget > slideCountMax) {
    throw new Error('--slide-count must be less than or equal to --max-slides.')
  }
}

function parseCommandPrefix(value: string | undefined, flagName: string): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  const trimmed = value.trim()

  if (trimmed === '') {
    throw new Error(`${flagName} must not be empty.`)
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown

    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || item.length === 0)) {
      throw new Error(`${flagName} JSON value must be an array of non-empty strings.`)
    }

    return parsed
  }

  return [trimmed]
}

function mapDeckFormat(format: DeckFormatFlag): DeckFormat {
  if (format === 'landscape') {
    return 'landscape_1920x1080'
  }

  if (format === 'square') {
    return 'square_1080x1080'
  }

  return 'portrait_1080x1920'
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
