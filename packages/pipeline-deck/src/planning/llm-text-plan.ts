import type {GenerateObjectRequest, LLMClient, LLMMessage} from '@video-agent/llm'

import {deckTemplateManifestForLLM} from '@video-agent/renderer-deck'

import {
  LLM_TEXT_DECK_MAX_SLIDES,
  LLMTextDeckContentAnalysisSchema,
  LLMTextDeckPlanSchema,
  LLMTextDeckScriptSemanticsSchema,
  LLMTextDeckSlidePlanSchema,
  type LLMTextDeckContentAnalysis,
  type LLMTextDeckPlan,
  type LLMTextDeckScriptSemantics,
  type LLMTextDeckSlidePlan,
} from './llm-plan.js'
import type {TextDeckProjectPlan, TextDeckProjectPlanOptions} from './types.js'
import {DECK_THEME_DESCRIPTIONS} from './utils.js'
import {createTextDeckProjectPlanFromLLM} from './text-plan-builder.js'

const DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS = 60_000
const DECK_LLM_TRANSCRIPT_SEGMENT_CHUNK_SIZE = 500
const DECK_LLM_TRANSCRIPT_SEGMENT_TEXT_MAX_CHARACTERS = 500
const DECK_LLM_VALIDATION_REWRITE_ATTEMPTS = 3

type DeckLLMPlanningStage = 'content-analysis' | 'content-analysis-merge' | 'script-semantics' | 'slide-plan'

interface DeckPlanningSourceChunk {
  chunkId: string
  text: string
  transcriptSegments?: Array<{
    end: number
    index: number
    speaker?: string
    start: number
    text: string
  }>
}

interface StagedDeckPlan {
  analysis: LLMTextDeckContentAnalysis
  finalPlan: LLMTextDeckPlan
  scriptSemantics: LLMTextDeckScriptSemantics
  slidePlan: LLMTextDeckSlidePlan
}

interface DeckPlanningValidationIssue {
  code: string
  message: string
  path?: string
  slideIndex?: number
  stage: DeckLLMPlanningStage | 'final-build'
}

export async function createLLMTextDeckProjectPlan(
  llm: LLMClient,
  inputPath: string,
  text: string,
  options: TextDeckProjectPlanOptions,
): Promise<TextDeckProjectPlan> {
  const planOptions = {...options}
  requireDeckPlanningSourceType(planOptions.sourceType)
  const stagedPlan = await createStagedDeckPlan(llm, inputPath, text, planOptions)

  try {
    return createTextDeckProjectPlanFromLLM(inputPath, text, stagedPlan.finalPlan, planOptions)
  } catch (error) {
    return rewriteInvalidStagedDeckPlan(llm, {
      error,
      inputPath,
      options: planOptions,
      stagedPlan,
      text,
    })
  }
}

async function createStagedDeckPlan(
  llm: LLMClient,
  inputPath: string,
  text: string,
  options: TextDeckProjectPlanOptions,
): Promise<StagedDeckPlan> {
  const analysis = await createContentAnalysis(llm, inputPath, text, options)
  const slidePlan = await generateSlidePlan(llm, inputPath, analysis, options)
  const scriptSemantics = await generateScriptSemantics(llm, inputPath, analysis, slidePlan, options)
  const finalPlan = assembleFinalDeckPlan(analysis, slidePlan, scriptSemantics)

  return {
    analysis,
    finalPlan,
    scriptSemantics,
    slidePlan,
  }
}

async function createContentAnalysis(
  llm: LLMClient,
  inputPath: string,
  text: string,
  options: TextDeckProjectPlanOptions,
): Promise<LLMTextDeckContentAnalysis> {
  const chunks = createDeckPlanningSourceChunks(text, options)
  const analyses = await Promise.all(chunks.map(async (chunk) => {
    const result = await llm.generateObject(createContentAnalysisRequest(inputPath, chunk, options))

    return result.object
  }))

  if (analyses.length === 1) {
    const analysis = analyses[0]

    if (analysis === undefined) {
      throw new Error('Deck content analysis produced no analysis object.')
    }

    return analysis
  }

  const result = await llm.generateObject(createContentAnalysisMergeRequest(inputPath, analyses, options))

  return result.object
}

function createContentAnalysisRequest(
  inputPath: string,
  chunk: DeckPlanningSourceChunk,
  options: TextDeckProjectPlanOptions,
): GenerateObjectRequest<LLMTextDeckContentAnalysis> {
  return {
    messages: [createContentAnalysisMessage(inputPath, chunk, options)],
    schema: LLMTextDeckContentAnalysisSchema,
    temperature: 0.2,
  }
}

function createContentAnalysisMessage(inputPath: string, chunk: DeckPlanningSourceChunk, options: TextDeckProjectPlanOptions): LLMMessage {
  return {
    content: JSON.stringify({
      goal: 'Analyze the source content for a Deck explainer. Return document-level semantic analysis only; do not design slides or write speaker notes.',
      instructions: [
        'Use the final output language explicitly in the language field. If target.language is auto, choose the strongest source/user language from the input.',
        'Remove YAML frontmatter, Markdown syntax, code fences, table pipes, raw template markers, and implementation-only metadata from authored analysis fields.',
        'Infer source structure, coverage, section importance, key claims, caveats, examples, evidence, and output shape from the source.',
        'For agent skills, internal instruction documents, methods, or frameworks, preserve workflow, input/output shape, quality bar, validation criteria, caveats, and concrete examples as first-class sections.',
        'When translating or rewriting, preserve the source-domain meaning of technical terms and object nouns. Do not substitute terms from unrelated domains unless the source uses them.',
        'Do not split text by character count for meaning. Merge related source details into coherent source-grounded sections.',
        'Do not author visible slide text, template choices, speaker notes, transitions, motion, or visual style in this stage.',
      ],
      source: {
        chunkId: chunk.chunkId,
        durationSeconds: options.durationTargetSeconds,
        path: inputPath,
        sourceType: requireDeckPlanningSourceType(options.sourceType),
        text: chunk.text,
        transcriptSegments: chunk.transcriptSegments,
      },
      stage: 'content-analysis',
      target: createDeckPlanningTarget(options, {includeTemplateManifest: false}),
    }),
    role: 'user',
  }
}

function createContentAnalysisMergeRequest(
  inputPath: string,
  analyses: LLMTextDeckContentAnalysis[],
  options: TextDeckProjectPlanOptions,
): GenerateObjectRequest<LLMTextDeckContentAnalysis> {
  return {
    messages: [{
      content: JSON.stringify({
        goal: 'Merge chunk-level Deck content analyses into one source-grounded content analysis. Do not design slides or write speaker notes.',
        instructions: [
          'Preserve every major source idea, concrete example, caveat, evidence path, and output shape from the chunk analyses.',
          'Deduplicate overlapping sections without losing source-grounded specificity.',
          'Return stable section ids that can be referenced by later slide planning.',
          'Keep keyClaims tied to the merged section where they are most useful.',
        ],
        inputPath,
        partialAnalyses: analyses,
        stage: 'content-analysis-merge',
        target: createDeckPlanningTarget(options, {includeTemplateManifest: false}),
      }),
      role: 'user',
    }],
    schema: LLMTextDeckContentAnalysisSchema,
    temperature: 0.2,
  }
}

async function generateSlidePlan(
  llm: LLMClient,
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  options: TextDeckProjectPlanOptions,
  rewrite?: {
    attemptsRemaining: number
    invalidOutput: LLMTextDeckSlidePlan
    issues: DeckPlanningValidationIssue[]
  },
): Promise<LLMTextDeckSlidePlan> {
  const result = await llm.generateObject(createSlidePlanRequest(inputPath, analysis, options, rewrite))

  return result.object
}

function createSlidePlanRequest(
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  options: TextDeckProjectPlanOptions,
  rewrite?: {
    attemptsRemaining: number
    invalidOutput: LLMTextDeckSlidePlan
    issues: DeckPlanningValidationIssue[]
  },
): GenerateObjectRequest<LLMTextDeckSlidePlan> {
  const baseMessage: LLMMessage = {
    content: JSON.stringify({
      analysis,
      goal: 'Turn the content analysis into concise PPT-style slide data. Return slide structure, visible text, template data, visuals, motion, and transitions only.',
      instructions: [
        'Use concise visible text and respect each template field and limit in target.templateManifest.',
        'Choose slide type only from target.templateManifest.templates. Do not invent, rename, or translate type values.',
        'For visual.kind, choose one of chart, code, process, table, text, or title-card. Return assetRefs as an empty array.',
        'When target.requiredSlideTypes is provided, include every listed slide type at least once.',
        'Required code slides must include a non-empty code field, and required process slides must use the process type with concrete ordered points.',
        'Choose the slide count from source complexity, required slide types, template limits, and target duration. Do not follow a runtime-estimated fixed slide count.',
        'If content exceeds a template limit, split it into multiple slides instead of overfilling one slide.',
        'Do not put multiple unrelated themes on one slide; split by topic before choosing a template.',
        'When the source contains code fences, shell commands, configuration snippets, API examples, or code_sample references, include at least one code slide that preserves a short representative snippet in code.text.',
        'For code slides, remove Markdown fences and raw template markers from visible text, but preserve the executable command, configuration, request, response, or schema content needed by the viewer.',
        'For explainer decks with more than three slides, end with a summary slide that restates the main takeaways and next practical action.',
        'Only use comparison, stat, chart, quote, or code when the matching structured field is complete.',
        'Return transitionOut for every slide. For the final slide, set transitionOut to null.',
        'Choose motion only from controlled presets; do not describe CSS, colors, fonts, or absolute positions.',
      ],
      inputPath,
      stage: 'slide-plan',
      target: createDeckPlanningTarget(options, {includeTemplateManifest: true}),
    }),
    role: 'user',
  }

  if (rewrite === undefined) {
    return {
      messages: [baseMessage],
      schema: LLMTextDeckSlidePlanSchema,
      temperature: 0.2,
    }
  }

  return {
    messages: [
      baseMessage,
      {
        content: JSON.stringify({
          invalidOutput: rewrite.invalidOutput,
          issues: rewrite.issues,
          stage: 'slide-plan',
        }),
        role: 'assistant',
      },
      {
        content: JSON.stringify({
          attemptsRemaining: rewrite.attemptsRemaining,
          goal: 'Rewrite the slide-plan stage output so it satisfies the structured validation issues. Return a complete replacement slide-plan object, not a patch.',
          instructions: [
            'Use issues as binding field-level feedback.',
            'Only change slide structure, visible text, template data, visual kind, motion, theme, platform, and transition choices needed to satisfy the issues.',
            'Keep source-grounded meaning and required slide types.',
            'Do not write speaker notes, source ranges, outline, or semantic metadata in this stage.',
          ],
          issues: rewrite.issues,
        }),
        role: 'user',
      },
    ],
    schema: LLMTextDeckSlidePlanSchema,
    temperature: 0.2,
  }
}

async function generateScriptSemantics(
  llm: LLMClient,
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  slidePlan: LLMTextDeckSlidePlan,
  options: TextDeckProjectPlanOptions,
  rewrite?: {
    attemptsRemaining: number
    invalidOutput: LLMTextDeckScriptSemantics
    issues: DeckPlanningValidationIssue[]
  },
): Promise<LLMTextDeckScriptSemantics> {
  const result = await llm.generateObject(createScriptSemanticsRequest(inputPath, analysis, slidePlan, options, rewrite))

  return result.object
}

function createScriptSemanticsRequest(
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  slidePlan: LLMTextDeckSlidePlan,
  options: TextDeckProjectPlanOptions,
  rewrite?: {
    attemptsRemaining: number
    invalidOutput: LLMTextDeckScriptSemantics
    issues: DeckPlanningValidationIssue[]
  },
): GenerateObjectRequest<LLMTextDeckScriptSemantics> {
  const baseMessage: LLMMessage = {
    content: JSON.stringify({
      analysis,
      goal: 'Write narration, slide semantic metadata, source ranges, durations, and outline for the approved slide plan.',
      instructions: [
        'Return one scriptSemantics slide entry per slidePlan slide, using matching zero-based slideIndex values.',
        'Write one natural speakerNote per slide for TTS. It should sound like a presenter guiding the viewer through the slide, not a file reader.',
        'The speakerNote must walk the viewer through the on-screen content in order and expand each visible point into a natural spoken sentence.',
        'Do not introduce new arguments, examples, claims, or steps that are not visible on the current slide, except brief transition phrases.',
        'For comparison slides, describe both sides. For code slides, briefly explain each visible section. For stat, quote, and chart slides, mention the displayed value, quote, or chart takeaway.',
        'For semantic.blockType, choose claim, context, data, example, quote, recommendation, or summary.',
        'Always return semantic.claim explicitly. Use null only when the slide should not create a claim artifact.',
        'Return calibrated semantic.claim.confidence and semantic.momentScore numbers from 0 to 1.',
        'For semantic.sourceQuoteText, choose or paraphrase the most relevant source-backed evidence for the slide.',
        'When source transcript segments are available, choose sourceRange from timed transcript evidence; otherwise author an intended presentation timeline range.',
        'Return outline with exactly one section per slide in slide order.',
      ],
      inputPath,
      slidePlan,
      source: {
        durationSeconds: options.durationTargetSeconds,
        sourceType: requireDeckPlanningSourceType(options.sourceType),
      },
      stage: 'script-semantics',
      target: createDeckPlanningTarget(options, {includeTemplateManifest: false}),
    }),
    role: 'user',
  }

  if (rewrite === undefined) {
    return {
      messages: [baseMessage],
      schema: LLMTextDeckScriptSemanticsSchema,
      temperature: 0.2,
    }
  }

  return {
    messages: [
      baseMessage,
      {
        content: JSON.stringify({
          invalidOutput: rewrite.invalidOutput,
          issues: rewrite.issues,
          stage: 'script-semantics',
        }),
        role: 'assistant',
      },
      {
        content: JSON.stringify({
          attemptsRemaining: rewrite.attemptsRemaining,
          goal: 'Rewrite the script-semantics stage output so it satisfies the structured validation issues. Return a complete replacement script-semantics object, not a patch.',
          instructions: [
            'Use issues as binding field-level feedback.',
            'Only change speaker notes, durations, source ranges, outline, and semantic metadata needed to satisfy the issues.',
            'Keep all slidePlan visible text, template data, motion, visual, and transition choices unchanged.',
            'Do not ask the runtime to infer, clip, shorten, or repair semantic content.',
          ],
          issues: rewrite.issues,
        }),
        role: 'user',
      },
    ],
    schema: LLMTextDeckScriptSemanticsSchema,
    temperature: 0.2,
  }
}

async function rewriteInvalidStagedDeckPlan(
  llm: LLMClient,
  input: {
    error: unknown
    inputPath: string
    options: TextDeckProjectPlanOptions
    stagedPlan: StagedDeckPlan
    text: string
  },
): Promise<TextDeckProjectPlan> {
  return attemptStagedDeckPlanRewrite(llm, input, {
    attempt: 1,
    lastError: input.error,
    stagedPlan: input.stagedPlan,
  })
}

async function attemptStagedDeckPlanRewrite(
  llm: LLMClient,
  input: {
    inputPath: string
    options: TextDeckProjectPlanOptions
    text: string
  },
  state: {
    attempt: number
    lastError: unknown
    stagedPlan: StagedDeckPlan
  },
): Promise<TextDeckProjectPlan> {
  if (state.attempt > DECK_LLM_VALIDATION_REWRITE_ATTEMPTS) {
    throw new Error(`Deck LLM staged rewrite failed after ${DECK_LLM_VALIDATION_REWRITE_ATTEMPTS} validation feedback attempt(s): ${formatErrorMessage(state.lastError)}`, {
      cause: state.lastError,
    })
  }

  const issues = createDeckPlanningValidationIssues(state.lastError)
  const rewriteStage = chooseRewriteStage(issues)
  const attemptsRemaining = DECK_LLM_VALIDATION_REWRITE_ATTEMPTS - state.attempt
  let stagedPlan: StagedDeckPlan

  if (rewriteStage === 'slide-plan') {
    const slidePlan = await generateSlidePlan(llm, input.inputPath, state.stagedPlan.analysis, input.options, {
      attemptsRemaining,
      invalidOutput: state.stagedPlan.slidePlan,
      issues,
    })
    const scriptSemantics = await generateScriptSemantics(llm, input.inputPath, state.stagedPlan.analysis, slidePlan, input.options)

    stagedPlan = {
      analysis: state.stagedPlan.analysis,
      finalPlan: assembleFinalDeckPlan(state.stagedPlan.analysis, slidePlan, scriptSemantics),
      scriptSemantics,
      slidePlan,
    }
  } else {
    const scriptSemantics = await generateScriptSemantics(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.slidePlan, input.options, {
      attemptsRemaining,
      invalidOutput: state.stagedPlan.scriptSemantics,
      issues,
    })

    stagedPlan = {
      analysis: state.stagedPlan.analysis,
      finalPlan: assembleFinalDeckPlan(state.stagedPlan.analysis, state.stagedPlan.slidePlan, scriptSemantics),
      scriptSemantics,
      slidePlan: state.stagedPlan.slidePlan,
    }
  }

  try {
    return createTextDeckProjectPlanFromLLM(input.inputPath, input.text, stagedPlan.finalPlan, input.options)
  } catch (error) {
    return attemptStagedDeckPlanRewrite(llm, input, {
      attempt: state.attempt + 1,
      lastError: error,
      stagedPlan,
    })
  }
}

function assembleFinalDeckPlan(
  analysis: LLMTextDeckContentAnalysis,
  slidePlan: LLMTextDeckSlidePlan,
  scriptSemantics: LLMTextDeckScriptSemantics,
): LLMTextDeckPlan {
  const semanticSlidesByIndex = new Map(scriptSemantics.slides.map((slide) => [slide.slideIndex, slide]))

  if (semanticSlidesByIndex.size !== slidePlan.slides.length) {
    throw new Error(`Deck script-semantics stage must return exactly one entry per slide-plan slide; got ${semanticSlidesByIndex.size} for ${slidePlan.slides.length}.`)
  }

  const finalPlan = LLMTextDeckPlanSchema.parse({
    ...(analysis.audience === undefined ? {} : {audience: analysis.audience}),
    language: analysis.language,
    outline: scriptSemantics.outline,
    slides: slidePlan.slides.map((slide, index) => {
      const scriptSlide = semanticSlidesByIndex.get(index)

      if (scriptSlide === undefined) {
        throw new Error(`Deck script-semantics stage is missing slideIndex ${index}.`)
      }

      return {
        ...(slide.chart === undefined ? {} : {chart: slide.chart}),
        ...(slide.code === undefined ? {} : {code: slide.code}),
        ...(slide.comparison === undefined ? {} : {comparison: slide.comparison}),
        duration: scriptSlide.duration,
        motion: slide.motion,
        points: slide.points,
        ...(slide.quote === undefined ? {} : {quote: slide.quote}),
        semantic: scriptSlide.semantic,
        sourceRange: scriptSlide.sourceRange,
        speakerNote: scriptSlide.speakerNote,
        ...(slide.stat === undefined ? {} : {stat: slide.stat}),
        ...(slide.subtitle === undefined ? {} : {subtitle: slide.subtitle}),
        title: slide.title,
        transitionOut: slide.transitionOut,
        type: slide.type,
        visual: slide.visual,
      }
    }),
    summary: analysis.summary,
    targetPlatform: slidePlan.targetPlatform,
    theme: slidePlan.theme,
    title: slidePlan.title,
  })

  return finalPlan
}

function createDeckPlanningSourceChunks(text: string, options: TextDeckProjectPlanOptions): DeckPlanningSourceChunk[] {
  if (options.transcriptSegments !== undefined && options.transcriptSegments.length > DECK_LLM_TRANSCRIPT_SEGMENT_CHUNK_SIZE) {
    const summarizedSegments = summarizeTranscriptSegments(options.transcriptSegments)
    const chunks: DeckPlanningSourceChunk[] = []

    for (let index = 0; index < summarizedSegments.length; index += DECK_LLM_TRANSCRIPT_SEGMENT_CHUNK_SIZE) {
      const transcriptSegments = summarizedSegments.slice(index, index + DECK_LLM_TRANSCRIPT_SEGMENT_CHUNK_SIZE)
      chunks.push({
        chunkId: `transcript-${String(chunks.length + 1).padStart(3, '0')}`,
        text: transcriptSegments.map((segment) => segment.text).join('\n'),
        transcriptSegments,
      })
    }

    return chunks
  }

  const transcriptSegments = options.transcriptSegments === undefined ? undefined : summarizeTranscriptSegments(options.transcriptSegments)

  if (text.length <= DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS) {
    return [{
      chunkId: 'text-001',
      text,
      ...(transcriptSegments === undefined ? {} : {transcriptSegments}),
    }]
  }

  return splitSourceTextIntoChunks(text).map((chunkText, index) => ({
    chunkId: `text-${String(index + 1).padStart(3, '0')}`,
    text: chunkText,
    ...(transcriptSegments === undefined ? {} : {transcriptSegments}),
  }))
}

function splitSourceTextIntoChunks(text: string): string[] {
  const chunks: string[] = []
  const paragraphs = text.split(/(?<=\n)\n+/u)
  let current = ''

  for (const paragraph of paragraphs) {
    if (paragraph.length > DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS) {
      if (current !== '') {
        chunks.push(current)
        current = ''
      }

      for (let index = 0; index < paragraph.length; index += DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS) {
        chunks.push(paragraph.slice(index, index + DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS))
      }

      continue
    }

    if (current.length > 0 && current.length + paragraph.length > DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS) {
      chunks.push(current)
      current = paragraph
      continue
    }

    current += paragraph
  }

  if (current !== '') {
    chunks.push(current)
  }

  if (chunks.length === 0) {
    throw new Error('Deck LLM planning source text is empty.')
  }

  return chunks
}

function requireDeckPlanningSourceType(sourceType: TextDeckProjectPlanOptions['sourceType']): NonNullable<TextDeckProjectPlanOptions['sourceType']> {
  if (sourceType === undefined) {
    throw new Error('Deck LLM planning requires an explicit sourceType before request construction; no request-time sourceType fallback is allowed.')
  }

  return sourceType
}

function createDeckPlanningTarget(options: TextDeckProjectPlanOptions, settings: {includeTemplateManifest: boolean}): object {
  return {
    availableThemes: Object.entries(DECK_THEME_DESCRIPTIONS).map(([name, description]) => ({description, name})),
    durationSeconds: options.durationTargetSeconds,
    format: options.deckFormat ?? 'portrait_1080x1920',
    language: options.language,
    maxVisibleCharactersPerSlide: options.maxSlideCharacters,
    requestedTheme: options.theme === undefined || options.theme === 'auto' ? undefined : options.theme,
    requestedTitle: options.title,
    requiresOutline: true,
    requiresSlideTransitions: true,
    requiresSlideSourceRanges: true,
    requiredSlideTypes: options.requiredSlideTypes,
    slideCountLimits: {
      maximum: LLM_TEXT_DECK_MAX_SLIDES,
      minimum: Math.max(1, options.requiredSlideTypes?.length ?? 1),
    },
    speakerNotePlanning: 'Choose narration density per slide from the visible content and target duration; no fixed per-slide character estimate is provided by the runtime.',
    targetPlatforms: ['douyin', 'kuaishou', 'bilibili', 'youtube', 'xhs', 'generic'],
    ...(settings.includeTemplateManifest ? {templateManifest: deckTemplateManifestForLLM} : {}),
  }
}

function summarizeTranscriptSegments(segments: NonNullable<TextDeckProjectPlanOptions['transcriptSegments']>): Array<{
  end: number
  index: number
  speaker?: string
  start: number
  text: string
}> {
  return segments
    .map((segment, index) => {
      const text = segment.text

      if (text.trim() === '') {
        throw new Error(`Deck LLM planning transcript segment ${index + 1} is empty; no silent segment filtering is allowed.`)
      }

      if (text !== text.trim()) {
        throw new Error(`Deck LLM planning transcript segment ${index + 1} contains leading or trailing whitespace; no runtime transcript segment trim is allowed.`)
      }

      if (text.length > DECK_LLM_TRANSCRIPT_SEGMENT_TEXT_MAX_CHARACTERS) {
        throw new Error(`Deck LLM planning transcript segment ${index + 1} has ${text.length} characters, exceeding the single-request segment limit ${DECK_LLM_TRANSCRIPT_SEGMENT_TEXT_MAX_CHARACTERS}; no silent segment truncation is allowed.`)
      }

      return {
        end: segment.end,
        index,
        ...(segment.speaker === undefined ? {} : {speaker: segment.speaker}),
        start: segment.start,
        text,
      }
    })
}

function createDeckPlanningValidationIssues(error: unknown): DeckPlanningValidationIssue[] {
  const message = formatErrorMessage(error)
  const slideIndex = parseSlideIndex(message)
  const path = parseIssuePath(message)

  return [{
    code: classifyIssueCode(message),
    message,
    ...(path === undefined ? {} : {path}),
    ...(slideIndex === undefined ? {} : {slideIndex}),
    stage: classifyValidationStage(message),
  }]
}

function chooseRewriteStage(issues: DeckPlanningValidationIssue[]): 'script-semantics' | 'slide-plan' {
  return issues.some((issue) => issue.stage === 'slide-plan') ? 'slide-plan' : 'script-semantics'
}

function classifyValidationStage(message: string): DeckPlanningValidationIssue['stage'] {
  if (
    message.includes('template')
    || message.includes('visible characters')
    || message.includes('maxSlideCharacters')
    || message.includes('point')
    || message.includes('title')
    || message.includes('subtitle')
    || message.includes('chart')
    || message.includes('code')
    || message.includes('comparison')
    || message.includes('quote template')
    || message.includes('stat')
    || message.includes('visual.kind')
    || message.includes('transitionOut')
  ) {
    return 'slide-plan'
  }

  if (
    message.includes('speakerNote')
    || message.includes('sourceRange')
    || message.includes('semantic')
    || message.includes('outline')
    || message.includes('claim')
    || message.includes('moment')
  ) {
    return 'script-semantics'
  }

  return 'final-build'
}

function classifyIssueCode(message: string): string {
  if (message.includes('maxSlideCharacters') || message.includes('visible characters')) {
    return 'VISIBLE_TEXT_LIMIT'
  }

  if (message.includes('sourceRange')) {
    return 'SOURCE_RANGE'
  }

  if (message.includes('outline')) {
    return 'OUTLINE'
  }

  if (message.includes('template')) {
    return 'TEMPLATE_CONSTRAINT'
  }

  if (message.includes('transitionOut')) {
    return 'TRANSITION'
  }

  if (message.includes('semantic')) {
    return 'SEMANTIC_METADATA'
  }

  return 'VALIDATION_ERROR'
}

function parseSlideIndex(message: string): number | undefined {
  const match = /slide\s+(\d+)/iu.exec(message)

  if (match?.[1] === undefined) {
    return undefined
  }

  return Number.parseInt(match[1], 10) - 1
}

function parseIssuePath(message: string): string | undefined {
  if (message.includes('speakerNote')) {
    return 'slides[].speakerNote'
  }

  if (message.includes('sourceRange')) {
    return 'slides[].sourceRange'
  }

  if (message.includes('outline')) {
    return 'outline.sections'
  }

  if (message.includes('transitionOut')) {
    return 'slides[].transitionOut'
  }

  if (message.includes('visible characters') || message.includes('maxSlideCharacters')) {
    return 'slides[]'
  }

  return undefined
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
