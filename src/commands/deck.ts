import type {DeckFormat} from '@video-agent/ir'

import {Args, Command, Flags} from '@oclif/core'
import {runDeckExplainerPipeline} from '@video-agent/pipeline-deck'
import {resolve} from 'node:path'

type DeckFormatFlag = 'landscape' | 'portrait' | 'square'
type DeckModeFlag = 'audio-anchored' | 'script-generated' | 'summarize'

export default class Deck extends Command {
  static args = {
    input: Args.string({description: 'Input text or markdown file to convert into a PPT-style explainer video project', required: true}),
  }

  static description = 'Run the Deck Explainer pipeline from content to final slide video'

  static flags = {
    'chromium-command': Flags.string({description: 'Chromium command prefix for HTML frame capture, either a binary name or JSON string array'}),
    duration: Flags.string({description: 'Target deck duration, such as 180s, 3m, or 00:03:00'}),
    format: Flags.string({
      default: 'portrait',
      description: 'Output slide format',
      options: ['landscape', 'portrait', 'square'],
    }),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    language: Flags.string({description: 'Narration/deck language tag', default: 'zh-CN'}),
    'max-slide-characters': Flags.integer({description: 'Maximum characters per generated slide', default: 260}),
    mode: Flags.string({
      default: 'script-generated',
      description: 'Deck generation mode',
      options: ['script-generated', 'summarize', 'audio-anchored'],
    }),
    'project-id': Flags.string({description: 'Project id to use for the workspace'}),
    'slide-seconds': Flags.integer({description: 'Fallback duration in seconds for each generated slide', default: 18}),
    style: Flags.string({
      default: 'elegant-dark',
      description: 'Deck theme/style name',
      options: ['elegant-dark', 'clean-white', 'finance-terminal', 'tech-gradient', 'minimal-editorial', 'warm-paper'],
    }),
    title: Flags.string({description: 'Title to use for the first slide and DeckIR'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Deck)
    const mode = flags.mode as DeckModeFlag

    const commonOptions = {
      deckFormat: mapDeckFormat(flags.format as DeckFormatFlag),
      inputPath: resolve(args.input),
      language: flags.language,
      maxSlideCharacters: flags['max-slide-characters'],
      projectId: flags['project-id'],
      slideSeconds: flags['slide-seconds'],
      theme: flags.style,
      title: flags.title,
      workspaceDir: flags.workspace,
    }
    const output = await runDeckExplainerPipeline({
      ...commonOptions,
      chromiumCommand: parseCommandPrefix(flags['chromium-command']),
      durationTargetSeconds: flags.duration === undefined ? undefined : parseDurationSeconds(flags.duration),
      mode,
    })

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`Project: ${output.projectId}`)
    this.log(`Workspace: ${output.projectDir}`)
    this.log(`Slides: ${output.deck.slides}`)
    this.log(`Status: ${output.status}`)
    this.log(`HTML: ${output.finalRender.htmlEntryPath}`)
    this.log(`Final: ${output.finalRender.outputPath}`)
  }
}

function parseCommandPrefix(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  const trimmed = value.trim()

  if (trimmed === '') {
    throw new Error('--chromium-command must not be empty.')
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown

    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || item.length === 0)) {
      throw new Error('--chromium-command JSON value must be an array of non-empty strings.')
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
