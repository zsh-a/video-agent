import {mkdir, readFile, stat, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {performance} from 'node:perf_hooks'

import {DeckSchema, type Deck, type DeckFormat, type DeckSlideType} from '@video-agent/ir'

import {
  createDeckAudioAnchoredProject,
  createDeckExplainerProject,
  runDeckExplainerPipeline,
  type CreateDeckAudioAnchoredProjectResult,
  type CreateDeckExplainerProjectResult,
  type RunDeckExplainerPipelineResult,
} from '@video-agent/pipeline-deck'
import {readProjectProviderReport, readProjectQuality} from '@video-agent/runtime'

interface GoldenCaseManifest {
  cases: GoldenCase[]
  version: number
}

interface GoldenCase {
  expected: {
    forbid?: string[]
    maxSlides: number
    minSlides: number
    mustMention: string[]
    qualityMustPass: boolean
    requiredSlideTypes: DeckSlideType[]
  }
  fixturePolicy?: string
  id: string
  input: {
    kind: 'audio' | 'markdown'
    path: string
  }
  language: string
  mode: 'audio-anchored' | 'script-generated'
  pipeline: 'deck'
  run: {
    command: string
  }
  source: {
    downloadUrl: string
    license: string
    licenseUrl: string
    name: string
  }
}

interface GoldenRunnerOptions {
  caseIds: string[]
  dryRun: boolean
  outputDir?: string
  renderer: 'html' | 'remotion'
  skipRender: boolean
  trace: boolean
  workspaceDir: string
}

interface GoldenRunReport {
  generatedAt: string
  options: {
    caseIds: string[]
    dryRun: boolean
    renderer: 'html' | 'remotion'
    skipRender: boolean
    trace: boolean
    workspaceDir: string
  }
  results: GoldenRunResult[]
  summary: {
    failed: number
    planned: number
    skipped: number
    succeeded: number
    total: number
  }
  version: number
}

interface GoldenRunResult {
  caseId: string
  deck?: {
    slides?: number
    status?: string
  }
  durationMs: number
  error?: string
  expected: GoldenCase['expected']
  expectation?: GoldenExpectationResult
  fixtureExists: boolean
  fixturePath: string
  mode: GoldenCase['mode']
  projectDir?: string
  projectId: string
  providerReport?: unknown
  quality?: unknown
  render?: {
    outputPath?: string
    renderer?: string
    status?: string
  }
  runCommand: string
  source: GoldenCase['source']
  status: 'failed' | 'planned' | 'skipped' | 'succeeded'
}

interface GoldenExpectationResult {
  failures: string[]
  observed: {
    mentioned: string[]
    missingMentions: string[]
    presentForbidden: string[]
    slideCount: number
    slideTypes: string[]
  }
  passed: boolean
  warnings: string[]
}

const root = dirname(new URL(import.meta.url).pathname)
const manifestPath = join(root, 'cases.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as GoldenCaseManifest
const options = parseArgs(process.argv.slice(2))
const selectedCases = selectCases(manifest.cases, options.caseIds)
const generatedAt = new Date().toISOString()
const runId = generatedAt.replace(/[:.]/g, '-')
const outputDir = resolve(options.outputDir ?? join(root, 'runs', generatedAt.replace(/[:.]/g, '-')))
await mkdir(outputDir, {recursive: true})

const results = await selectedCases.reduce<Promise<GoldenRunResult[]>>(async (previous, goldenCase) => {
  const accumulated = await previous
  const result = await runGoldenCase(goldenCase, options)

  console.log(`${result.status.toUpperCase()} ${result.caseId} (${result.durationMs}ms)`)
  if (result.error !== undefined) {
    console.log(`  ${result.error}`)
  }

  return [...accumulated, result]
}, Promise.resolve([]))

const report: GoldenRunReport = {
  generatedAt,
  options: {
    caseIds: selectedCases.map((goldenCase) => goldenCase.id),
    dryRun: options.dryRun,
    renderer: options.renderer,
    skipRender: options.skipRender,
    trace: options.trace,
    workspaceDir: options.workspaceDir,
  },
  results,
  summary: summarizeResults(results),
  version: 1,
}
const reportPath = join(outputDir, 'report.json')

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`Report: ${reportPath}`)

if (report.summary.failed > 0) {
  process.exitCode = 1
}

async function runGoldenCase(goldenCase: GoldenCase, options: GoldenRunnerOptions): Promise<GoldenRunResult> {
  const startedAt = performance.now()
  const fixturePath = resolve(root, goldenCase.input.path)
  const fixtureExists = await pathExists(fixturePath)
  const projectId = `golden-${goldenCase.id}-${runId}`
  const baseResult = (): Omit<GoldenRunResult, 'durationMs' | 'status'> => ({
    caseId: goldenCase.id,
    expected: goldenCase.expected,
    fixtureExists,
    fixturePath,
    mode: goldenCase.mode,
    projectId,
    runCommand: effectiveRunCommand(goldenCase.run.command, projectId),
    source: goldenCase.source,
  })

  if (options.dryRun) {
    return {
      ...baseResult(),
      durationMs: elapsedMs(startedAt),
      status: 'planned',
    }
  }

  if (!fixtureExists) {
    return {
      ...baseResult(),
      durationMs: elapsedMs(startedAt),
      error: goldenCase.fixturePolicy === 'manual-excerpt'
        ? 'Fixture is missing. Create the manual excerpt described by this case before running it.'
        : 'Fixture is missing. Run bun examples/golden-cases/fetch-fixtures.ts first.',
      status: 'skipped',
    }
  }

  try {
    const runResult = options.skipRender
      ? await runPlanOnly(goldenCase, fixturePath, projectId, options)
      : await runFullPipeline(goldenCase, fixturePath, projectId, options)
    const quality = await readOptional(() => readProjectQuality(projectId, options.workspaceDir))
    const providerReport = await readOptional(() => readProjectProviderReport(projectId, {workspaceDir: options.workspaceDir}))
    const deck = await readOptional(() => readDeckArtifact(runResult.projectDir))
    const expectation = validateExpectations(goldenCase, deck, quality, providerReport)

    return {
      ...baseResult(),
      deck: {
        slides: runResult.deck.slides,
        status: runResult.deck.status,
      },
      durationMs: elapsedMs(startedAt),
      error: expectation.passed ? undefined : expectation.failures.join('; '),
      expectation,
      projectDir: runResult.projectDir,
      providerReport,
      quality,
      render: runResult.render,
      status: expectation.passed ? 'succeeded' : 'failed',
    }
  } catch (error) {
    return {
      ...baseResult(),
      durationMs: elapsedMs(startedAt),
      error: error instanceof Error ? error.message : String(error),
      status: 'failed',
    }
  }
}

async function readDeckArtifact(projectDir: string): Promise<Deck> {
  return DeckSchema.parse(JSON.parse(await readFile(join(projectDir, 'artifacts', 'deck.json'), 'utf8')))
}

function validateExpectations(
  goldenCase: GoldenCase,
  deck: Deck | undefined,
  quality: unknown,
  providerReport: unknown,
): GoldenExpectationResult {
  const failures: string[] = []
  const warnings = llmExpectationWarnings(providerReport)

  if (deck === undefined) {
    failures.push('Missing deck.json; cannot validate golden expectations.')

    return {
      failures,
      observed: {
        mentioned: [],
        missingMentions: goldenCase.expected.mustMention,
        presentForbidden: [],
        slideCount: 0,
        slideTypes: [],
      },
      passed: false,
      warnings,
    }
  }

  const slideTypes: string[] = [...new Set(deck.slides.map((slide) => slide.type))]
  const visibleText = visibleDeckText(deck)
  const missingTypes = goldenCase.expected.requiredSlideTypes.filter((type) => !slideTypes.includes(type))
  const mentioned = goldenCase.expected.mustMention.filter((term) => containsTerm(visibleText, term))
  const missingMentions = goldenCase.expected.mustMention.filter((term) => !containsTerm(visibleText, term))
  const presentForbidden = (goldenCase.expected.forbid ?? []).filter((term) => containsTerm(visibleText, term))

  if (deck.slides.length < goldenCase.expected.minSlides || deck.slides.length > goldenCase.expected.maxSlides) {
    failures.push(`Slide count ${deck.slides.length} is outside expected range ${goldenCase.expected.minSlides}-${goldenCase.expected.maxSlides}.`)
  }

  if (missingTypes.length > 0) {
    failures.push(`Missing required slide type(s): ${missingTypes.join(', ')}.`)
  }

  if (missingMentions.length > 0) {
    failures.push(`Missing required visible mention(s): ${missingMentions.join(', ')}.`)
  }

  if (presentForbidden.length > 0) {
    failures.push(`Forbidden visible text found: ${presentForbidden.join(', ')}.`)
  }

  if (goldenCase.expected.qualityMustPass && qualityPasses(quality) === false) {
    failures.push('Project quality did not pass.')
  }

  if (goldenCase.expected.qualityMustPass && qualityPasses(quality) === undefined) {
    warnings.push('Project quality was unavailable; qualityMustPass could not be verified.')
  }

  return {
    failures,
    observed: {
      mentioned,
      missingMentions,
      presentForbidden,
      slideCount: deck.slides.length,
      slideTypes,
    },
    passed: failures.length === 0,
    warnings,
  }
}

function visibleDeckText(deck: Deck): string {
  const parts = [deck.title]

  for (const slide of deck.slides) {
    parts.push(slide.title)
    parts.push(slide.subtitle ?? '')
    parts.push(slide.speakerNote ?? '')
    parts.push(...slide.points)

    if (slide.comparison !== undefined) {
      parts.push(slide.comparison.left.label, slide.comparison.right.label)
      parts.push(...slide.comparison.left.points, ...slide.comparison.right.points)
    }

    if (slide.code !== undefined) {
      parts.push(slide.code.language, slide.code.text)
    }

    if (slide.quote !== undefined) {
      parts.push(slide.quote.text, slide.quote.attribution ?? '')
    }

    if (slide.stat !== undefined) {
      parts.push(slide.stat.value, slide.stat.label, slide.stat.caption ?? '')
    }
  }

  return parts.join('\n')
}

function containsTerm(text: string, term: string): boolean {
  return text.toLocaleLowerCase().includes(term.toLocaleLowerCase())
}

function qualityPasses(quality: unknown): boolean | undefined {
  if (!isRecord(quality) || typeof quality.ok !== 'boolean') {
    return undefined
  }

  return quality.ok
}

function llmExpectationWarnings(providerReport: unknown): string[] {
  const warnings: string[] = []

  if (!isRecord(providerReport) || !isRecord(providerReport.summary) || !isRecord(providerReport.summary.llm) || !isRecord(providerReport.summary.llm.byOperation)) {
    return warnings
  }

  const generateObject = providerReport.summary.llm.byOperation.generateObject
  const fallback = providerReport.summary.llm.byOperation.generateObjectFallbackText

  if (isRecord(generateObject) && typeof generateObject.failed === 'number' && generateObject.failed > 0) {
    warnings.push(`LLM structured generation failed ${generateObject.failed} time(s).`)
  }

  if (isRecord(fallback) && typeof fallback.succeeded === 'number' && fallback.succeeded > 0) {
    warnings.push(`LLM fallback text generation succeeded ${fallback.succeeded} time(s).`)
  }

  return warnings
}

async function runPlanOnly(
  goldenCase: GoldenCase,
  inputPath: string,
  projectId: string,
  options: GoldenRunnerOptions,
): Promise<{
  deck: CreateDeckAudioAnchoredProjectResult | CreateDeckExplainerProjectResult
  projectDir: string
  render?: GoldenRunResult['render']
}> {
  const deckOptions = createDeckOptions(goldenCase, inputPath, projectId, options)
  const deck = goldenCase.mode === 'audio-anchored'
    ? await createDeckAudioAnchoredProject(deckOptions)
    : await createDeckExplainerProject(deckOptions)

  return {
    deck,
    projectDir: deck.projectDir,
  }
}

async function runFullPipeline(
  goldenCase: GoldenCase,
  inputPath: string,
  projectId: string,
  options: GoldenRunnerOptions,
): Promise<{
  deck: CreateDeckAudioAnchoredProjectResult | CreateDeckExplainerProjectResult
  projectDir: string
  render?: GoldenRunResult['render']
}> {
  const result = await runDeckExplainerPipeline({
    ...createDeckOptions(goldenCase, inputPath, projectId, options),
    mode: goldenCase.mode,
    renderer: options.renderer,
  }) as RunDeckExplainerPipelineResult

  return {
    deck: result.deck,
    projectDir: result.projectDir,
    render: {
      outputPath: result.finalRender.outputPath,
      renderer: result.finalRender.renderer,
      status: result.finalRender.status,
    },
  }
}

function createDeckOptions(goldenCase: GoldenCase, inputPath: string, projectId: string, options: GoldenRunnerOptions): {
  deckFormat: DeckFormat
  durationTargetSeconds?: number
  inputPath: string
  language: string
  projectId: string
  requiredSlideTypes: DeckSlideType[]
  trace: boolean
  workspaceDir: string
} {
  return {
    deckFormat: 'portrait_1080x1920',
    durationTargetSeconds: durationSecondsFromCommand(goldenCase.run.command),
    inputPath,
    language: goldenCase.language,
    projectId,
    requiredSlideTypes: goldenCase.expected.requiredSlideTypes,
    trace: options.trace,
    workspaceDir: options.workspaceDir,
  }
}

function parseArgs(args: string[]): GoldenRunnerOptions {
  const options: GoldenRunnerOptions = {
    caseIds: [],
    dryRun: false,
    renderer: 'remotion',
    skipRender: false,
    trace: false,
    workspaceDir: '.video-agent',
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg === '--skip-render') {
      options.skipRender = true
      continue
    }

    if (arg === '--trace') {
      options.trace = true
      continue
    }

    if (arg === '--case') {
      options.caseIds.push(...readValue(args, index, '--case').split(',').map((value) => value.trim()).filter(Boolean))
      index += 1
      continue
    }

    if (arg === '--output-dir') {
      options.outputDir = readValue(args, index, '--output-dir')
      index += 1
      continue
    }

    if (arg === '--renderer') {
      options.renderer = parseRenderer(readValue(args, index, '--renderer'))
      index += 1
      continue
    }

    if (arg === '--workspace') {
      options.workspaceDir = readValue(args, index, '--workspace')
      index += 1
      continue
    }

    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }

    throw new Error(`Unknown golden runner argument: ${arg}`)
  }

  return options
}

function selectCases(cases: GoldenCase[], caseIds: string[]): GoldenCase[] {
  if (caseIds.length === 0) {
    return cases
  }

  const byId = new Map(cases.map((goldenCase) => [goldenCase.id, goldenCase]))

  return caseIds.map((caseId) => {
    const goldenCase = byId.get(caseId)

    if (goldenCase === undefined) {
      throw new Error(`Unknown golden case: ${caseId}`)
    }

    return goldenCase
  })
}

function parseRenderer(value: string): GoldenRunnerOptions['renderer'] {
  if (value === 'html' || value === 'remotion') {
    return value
  }

  throw new Error(`--renderer must be html or remotion, got ${value}`)
}

function readValue(args: string[], index: number, flagName: string): string {
  const value = args[index + 1]

  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flagName} requires a value.`)
  }

  return value
}

function durationSecondsFromCommand(command: string): number | undefined {
  const parts = splitCommand(command)
  const durationIndex = parts.indexOf('--duration')

  if (durationIndex === -1) {
    return undefined
  }

  const value = parts[durationIndex + 1]

  if (value === undefined) {
    throw new Error(`Command is missing a value after --duration: ${command}`)
  }

  return parseDurationSeconds(value)
}

function splitCommand(command: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined

  for (const char of command) {
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined
        continue
      }

      current += char
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current !== '') {
        parts.push(current)
        current = ''
      }

      continue
    }

    current += char
  }

  if (quote !== undefined) {
    throw new Error(`Unterminated quote in command: ${command}`)
  }

  if (current !== '') {
    parts.push(current)
  }

  return parts
}

function effectiveRunCommand(command: string, projectId: string): string {
  const parts = splitCommand(command)
  const projectIdIndex = parts.indexOf('--project-id')

  if (projectIdIndex === -1) {
    parts.push('--project-id', projectId)
  } else {
    parts[projectIdIndex + 1] = projectId
  }

  return parts.map(formatCommandArg).join(' ')
}

function formatCommandArg(value: string): string {
  return /^[A-Za-z0-9_./:@=-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

async function readOptional<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read()
  } catch (_error) {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function summarizeResults(results: GoldenRunResult[]): GoldenRunReport['summary'] {
  return {
    failed: results.filter((result) => result.status === 'failed').length,
    planned: results.filter((result) => result.status === 'planned').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    succeeded: results.filter((result) => result.status === 'succeeded').length,
    total: results.length,
  }
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt)
}

function printHelp(): void {
  console.log(`Usage: bun examples/golden-cases/run-cases.ts [options]

Options:
  --case <id>        Run one case. Repeat or pass comma-separated ids.
  --dry-run          Plan cases and write report without requiring fixtures or providers.
  --skip-render      Generate Deck project artifacts only; skip voice synthesis and final render.
  --renderer <name>  Final renderer for full runs: remotion or html. Default: remotion.
  --workspace <dir>  Workspace directory. Default: .video-agent.
  --output-dir <dir> Report output directory. Default: examples/golden-cases/runs/<timestamp>.
  --trace            Write LLM traces during provider-backed runs.
`)
}
