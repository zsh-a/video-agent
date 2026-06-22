import type {DeckContentDensity, DeckFormat} from '@video-agent/ir'
import type {DeckHtmlCaptureBackend} from '@video-agent/ir'
import type {DeckExplainerPipelineMode, DeckFinalRenderer} from '@video-agent/pipeline-deck'

import {Args, Command, Flags} from '@oclif/core'
import {DECK_CONTENT_DENSITIES, DECK_PRESET_THEMES, DEFAULT_DECK_CONTENT_DENSITY, DEFAULT_DECK_FORMAT, DEFAULT_DECK_HTML_CAPTURE_BACKEND, TEXT_DOCUMENT_SOURCE_TYPES} from '@video-agent/ir'
import {DECK_HTML_CAPTURE_BACKENDS} from '@video-agent/ir'
import {DECK_EXPLAINER_PIPELINE_MODES, DECK_FINAL_RENDERERS, DEFAULT_DECK_FINAL_RENDERER, runDeckExplainerPipeline} from '@video-agent/pipeline-deck'
import {resolve} from 'node:path'

import {normalizePositiveIntegerFlag as normalizePositiveInteger, normalizeRequiredPositiveIntegerFlag as normalizeRequiredPositiveInteger, parseCommandPrefixFlag as parseCommandPrefix, parseDurationSeconds, parseOptionalEnumFlag, parseRequiredEnumFlag, workspaceFlag} from '../utils/cli-flags.js'

const DECK_FORMAT_FLAGS = ['landscape', 'portrait', 'square'] as const
const DECK_FORMAT_BY_FLAG = {
  landscape: 'landscape_1920x1080',
  portrait: 'portrait_1080x1920',
  square: 'square_1080x1080',
} as const satisfies Record<string, DeckFormat>

const DECK_STYLE_OPTIONS = ['auto', ...DECK_PRESET_THEMES] as const

type DeckFormatFlag = (typeof DECK_FORMAT_FLAGS)[number]
type DeckSourceTypeFlag = (typeof TEXT_DOCUMENT_SOURCE_TYPES)[number]

const DEFAULT_DECK_FORMAT_FLAG = deckFormatFlagFor(DEFAULT_DECK_FORMAT)

export default class Deck extends Command {
  static args = {
    input: Args.string({description: 'Input text or markdown file to convert into a PPT-style explainer video project', required: true}),
  }

  static description = 'Run the Deck Explainer pipeline from content to final slide video'

  static flags = {
    'chromium-command': Flags.string({description: 'Chromium command prefix for HTML frame capture, either a binary name or JSON string array'}),
    'content-density': Flags.string({default: DEFAULT_DECK_CONTENT_DENSITY, description: 'Generated deck content density', options: [...DECK_CONTENT_DENSITIES]}),
    duration: Flags.string({description: 'Target deck duration, such as 180s, 3m, or 00:03:00'}),
    'frame-capture-backend': Flags.string({default: DEFAULT_DECK_HTML_CAPTURE_BACKEND, description: 'Browser backend for full frame sequence capture', options: [...DECK_HTML_CAPTURE_BACKENDS]}),
    'frame-concurrency': Flags.integer({description: 'Maximum browser screenshot captures to run concurrently', default: 1}),
    format: Flags.string({
      default: DEFAULT_DECK_FORMAT_FLAG,
      description: 'Output slide format',
      options: [...DECK_FORMAT_FLAGS],
    }),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'keyframe-capture-backend': Flags.string({default: DEFAULT_DECK_HTML_CAPTURE_BACKEND, description: 'Browser backend for independent keyframe visual QC', options: [...DECK_HTML_CAPTURE_BACKENDS]}),
    language: Flags.string({description: 'Narration/deck language tag; omit to let the LLM choose from the source'}),
    'max-slide-characters': Flags.integer({description: 'Maximum characters per generated slide', default: 260}),
    mode: Flags.string({
      description: 'Deck generation mode; required so the CLI does not infer script-generated, summarize, or audio-anchored behavior',
      options: [...DECK_EXPLAINER_PIPELINE_MODES],
    }),
    'project-id': Flags.string({description: 'Project id to use for the workspace'}),
    'playwright-command': Flags.string({description: 'Playwright capture command prefix, either a binary name or JSON string array'}),
    renderer: Flags.string({default: DEFAULT_DECK_FINAL_RENDERER, description: 'Deck video renderer', options: [...DECK_FINAL_RENDERERS]}),
    'max-slides': Flags.integer({description: 'Maximum generated slide count; must be between required slide minimum and the runtime cap'}),
    'slide-count': Flags.integer({description: 'Exact generated slide count target'}),
    'source-type': Flags.string({description: 'Required input source type for script-generated Deck planning; no extension-based inference is performed', options: [...TEXT_DOCUMENT_SOURCE_TYPES]}),
    style: Flags.string({
      description: 'Deck theme/style name (auto lets LLM choose based on content)',
      options: [...DECK_STYLE_OPTIONS],
    }),
    title: Flags.string({description: 'Title to use for the first slide and DeckIR'}),
    trace: Flags.boolean({description: 'Write full LLM request/response traces to project artifacts'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Deck)

    let output: Awaited<ReturnType<typeof runDeckExplainerPipeline>>

    try {
      const mode = requireDeckCliMode(parseOptionalEnumFlag<DeckExplainerPipelineMode>(flags.mode, DECK_EXPLAINER_PIPELINE_MODES, '--mode'))
      const slideCountTarget = normalizePositiveInteger(flags['slide-count'], '--slide-count')
      const slideCountMax = normalizePositiveInteger(flags['max-slides'], '--max-slides')

      validateSlideCountFlags(slideCountTarget, slideCountMax)

      output = await runDeckExplainerPipeline({
        chromiumCommand: parseCommandPrefix(flags['chromium-command'], '--chromium-command'),
        contentDensity: parseRequiredEnumFlag<DeckContentDensity>(flags['content-density'], DECK_CONTENT_DENSITIES, '--content-density'),
        deckFormat: mapDeckFormat(parseRequiredEnumFlag<DeckFormatFlag>(flags.format, DECK_FORMAT_FLAGS, '--format')),
        durationTargetSeconds: flags.duration === undefined ? undefined : parseDurationSeconds(flags.duration),
        frameCaptureBackend: parseRequiredEnumFlag<DeckHtmlCaptureBackend>(flags['frame-capture-backend'], DECK_HTML_CAPTURE_BACKENDS, '--frame-capture-backend'),
        frameConcurrency: normalizePositiveInteger(flags['frame-concurrency'], '--frame-concurrency'),
        inputPath: resolve(args.input),
        keyframeCaptureBackend: parseRequiredEnumFlag<DeckHtmlCaptureBackend>(flags['keyframe-capture-backend'], DECK_HTML_CAPTURE_BACKENDS, '--keyframe-capture-backend'),
        language: flags.language,
        maxSlideCharacters: normalizeRequiredPositiveInteger(flags['max-slide-characters'], '--max-slide-characters'),
        mode,
        playwrightCommand: parseCommandPrefix(flags['playwright-command'], '--playwright-command'),
        projectId: flags['project-id'],
        renderer: parseRequiredEnumFlag<DeckFinalRenderer>(flags.renderer, DECK_FINAL_RENDERERS, '--renderer'),
        slideCountMax,
        slideCountTarget,
        sourceType: parseOptionalEnumFlag<DeckSourceTypeFlag>(flags['source-type'], TEXT_DOCUMENT_SOURCE_TYPES, '--source-type'),
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

function requireDeckCliMode(mode: DeckExplainerPipelineMode | undefined): DeckExplainerPipelineMode {
  if (mode === undefined) {
    throw new Error('Deck command requires --mode; no CLI script-generated fallback is allowed.')
  }

  return mode
}

function validateSlideCountFlags(slideCountTarget: number | undefined, slideCountMax: number | undefined): void {
  if (slideCountTarget !== undefined && slideCountMax !== undefined && slideCountTarget > slideCountMax) {
    throw new Error('--slide-count must be less than or equal to --max-slides.')
  }
}

function mapDeckFormat(format: DeckFormatFlag): DeckFormat {
  return DECK_FORMAT_BY_FLAG[format]
}

function deckFormatFlagFor(format: DeckFormat): DeckFormatFlag {
  for (const [flag, value] of Object.entries(DECK_FORMAT_BY_FLAG) as Array<[DeckFormatFlag, DeckFormat]>) {
    if (value === format) {
      return flag
    }
  }

  throw new Error(`Deck CLI does not define a format flag for ${format}.`)
}
