import type {GenerateObjectRequest, LLMClient, LLMMessage} from '@video-agent/llm'
import type {ProjectAgentRuntime} from '@video-agent/runtime'

import {createHash} from 'node:crypto'

import {createObjectPromptRequest} from '@video-agent/llm'
import {DeckBriefSchema, DeckCoherenceReportSchema, DeckContentAnalysisSchema, DeckSlideOutlineSchema} from '@video-agent/ir'
import {deckTemplateManifestForLLM} from '@video-agent/renderer-deck'

import {
  LLM_TEXT_DECK_MAX_SLIDES,
  LLMTextDeckValidationError,
  LLMTextDeckBriefSchema,
  LLMTextDeckCoherenceReviewSchema,
  LLMTextDeckContentAnalysisSchema,
  LLMTextDeckPlanSchema,
  LLMTextDeckScriptSemanticsSchema,
  LLMTextDeckSlideOutlineSchema,
  LLMTextDeckSlidePlanSchema,
  validateLLMTextDeckSlidePlanTemplateConstraints,
  type LLMTextDeckValidationIssue,
  type LLMTextDeckBrief,
  type LLMTextDeckCoherenceReview,
  type LLMTextDeckContentAnalysis,
  type LLMTextDeckPlan,
  type LLMTextDeckScriptSemantics,
  type LLMTextDeckSlideOutline,
  type LLMTextDeckSlidePlan,
} from './llm-plan.js'
import type {TextDeckProjectPlan, TextDeckProjectPlanOptions} from './types.js'
import {assertNoGeneratedTextControlSyntax, cleanGeneratedText, DECK_THEME_DESCRIPTIONS} from './utils.js'
import {createTextDeckProjectPlanFromLLM} from './text-plan-builder.js'
import {createDeckSourceMap} from './source-map.js'

const DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS = 60_000
const DECK_LLM_TRANSCRIPT_SEGMENT_CHUNK_SIZE = 500
const DECK_LLM_TRANSCRIPT_SEGMENT_TEXT_MAX_CHARACTERS = 500
const DECK_LLM_VALIDATION_REWRITE_ATTEMPTS = 5
const DECK_LLM_CACHE_KEY_HASH_CHARACTERS = 24
const DECK_LLM_ENGLISH_WORDS_PER_SECOND = 2.6
const DECK_LLM_CJK_CHARACTERS_PER_SECOND = 4.8
const DECK_LLM_TOTAL_TIMING_ESTIMATE_TO_PLAN_RATIO = 1.35
const DECK_LLM_TOTAL_TIMING_GRACE_SECONDS = 3
const DECK_PROMPT_VERSION = '2026-06-20'

type DeckLLMPlanningStage = 'content-analysis' | 'content-analysis-merge' | 'coherence-review' | 'deck-brief' | 'script-semantics' | 'slide-outline' | 'slide-plan'

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
  brief: LLMTextDeckBrief
  coherenceReview: LLMTextDeckCoherenceReview
  options: TextDeckProjectPlanOptions
  scriptSemantics: LLMTextDeckScriptSemantics
  slideOutline: LLMTextDeckSlideOutline
  slidePlan: LLMTextDeckSlidePlan
}

interface DeckContentDensityTarget {
  level: NonNullable<TextDeckProjectPlanOptions['contentDensity']>
  narrationPolicy: string
  slideCountPolicy: string
  visibleTextPolicy: string
}

interface DeckSlideCountIntent {
  maximum: number
  minimum: number
  policy: string
  target?: number
}

interface DeckPlanningIntent {
  contentDensity: DeckContentDensityTarget
  durationSeconds?: number
  format: NonNullable<TextDeckProjectPlanOptions['deckFormat']>
  language: string
  maxVisibleCharactersPerSlide: number
  requestedTheme?: string
  requestedTitle?: string
  requiredSlideTypes?: TextDeckProjectPlanOptions['requiredSlideTypes']
  slideCount: DeckSlideCountIntent
}

type DeckPlanningValidationIssue = Omit<LLMTextDeckValidationIssue, 'stage'> & {
  escalationReason?: string
  forbiddenFixes?: string[]
  repairStrategy?: DeckPlanningRepairStrategy
  repeatCount?: number
  requiredAdditions?: string[]
  stage: DeckLLMPlanningStage | 'final-build'
}

type DeckPlanningRepairStrategy = 'rebalanceTimingOrNarration' | 'requireOperationalCriteria' | 'requirePracticalDetail' | 'requireTemplateReplan' | 'requireTransitionLogic' | 'satisfyValidation'

class DeckCoherenceReviewValidationError extends Error {
  readonly issues: DeckPlanningValidationIssue[]

  constructor(issues: DeckPlanningValidationIssue[]) {
    const firstError = issues[0]
    const issuePath = firstError?.path === undefined ? '' : ` Path: ${firstError.path}`

    super(firstError === undefined
      ? 'Deck coherence review requires rewrite.'
      : `Deck coherence review requires ${firstError.stage} rewrite: ${firstError.code}: ${firstError.message}${issuePath}`)
    this.issues = issues
  }
}

function createDeckLLMCacheHint(stage: DeckLLMPlanningStage, message: LLMMessage): NonNullable<GenerateObjectRequest<unknown>['cache']> {
  return {
    key: `deck:${stage}:${hashCacheMessage(message)}`,
    messageIndex: 0,
    mode: 'ephemeral',
  }
}

function hashCacheMessage(message: LLMMessage): string {
  return createHash('sha256')
    .update(JSON.stringify({
      content: message.content,
      role: message.role,
    }))
    .digest('hex')
    .slice(0, DECK_LLM_CACHE_KEY_HASH_CHARACTERS)
}

function createDeckObjectPromptRequest<TInput, TOutput>(input: {
  buildMessages: (promptInput: TInput) => LLMMessage[]
  id: string
  promptInput: TInput
  schema: GenerateObjectRequest<TOutput>['schema']
  schemaName: string
  stage: DeckLLMPlanningStage
  temperature: number
}): GenerateObjectRequest<TOutput> {
  return createObjectPromptRequest({
    buildMessages: input.buildMessages,
    cache: (_promptInput, messages) => createDeckLLMCacheHint(input.stage, requireFirstPromptMessage(messages, input.id)),
    id: input.id,
    schema: input.schema,
    schemaName: input.schemaName,
    stage: input.stage,
    temperature: input.temperature,
    version: DECK_PROMPT_VERSION,
  }, input.promptInput)
}

function requireFirstPromptMessage(messages: LLMMessage[], promptId: string): LLMMessage {
  const message = messages[0]

  if (message === undefined) {
    throw new Error(`Prompt "${promptId}" produced no messages.`)
  }

  return message
}

export async function createLLMTextDeckProjectPlan(
  llm: LLMClient,
  inputPath: string,
  text: string,
  options: TextDeckProjectPlanOptions,
  agent?: ProjectAgentRuntime,
): Promise<TextDeckProjectPlan> {
  const planOptions = {...options}
  requireDeckPlanningSourceType(planOptions.sourceType)
  const sourceMap = createDeckSourceMap({
    inputPath,
    language: planOptions.language,
    sourceType: requireDeckPlanningSourceType(planOptions.sourceType),
    text,
    title: planOptions.title,
  })
  const stagedPlan = await createStagedDeckPlan(llm, inputPath, text, sourceMap, planOptions, agent)
  const effectiveOptions = stagedPlan.options

  try {
    validateLLMTextDeckSlideCount(stagedPlan.slideOutline, effectiveOptions)
    validateLLMTextDeckSlidePlanStructure(stagedPlan.slidePlan, stagedPlan.slideOutline)
    validateLLMTextDeckScriptSemanticsStructure(stagedPlan.scriptSemantics, stagedPlan.slideOutline)
    assertCoherenceReview(stagedPlan.coherenceReview)
    validateLLMTextDeckScriptSemanticsTiming(stagedPlan.scriptSemantics, stagedPlan.slideOutline, effectiveOptions)
    const finalPlan = assembleFinalDeckPlan(stagedPlan.analysis, stagedPlan.slidePlan, stagedPlan.scriptSemantics)

    return createTextDeckProjectPlanFromLLM(inputPath, text, finalPlan, {
      ...effectiveOptions,
      contentAnalysis: createDeckContentAnalysisArtifact(stagedPlan.analysis),
      deckBrief: createDeckBriefArtifact(stagedPlan.brief),
      coherenceReport: createDeckCoherenceReport(stagedPlan.coherenceReview, stagedPlan.slidePlan),
      slideOutline: createDeckSlideOutlineArtifact(stagedPlan.slideOutline),
      sourceMap,
    })
  } catch (error) {
    return rewriteInvalidStagedDeckPlan(llm, {
      agent,
      error,
      inputPath,
      options: effectiveOptions,
      sourceMap,
      stagedPlan,
      text,
    })
  }
}

async function createStagedDeckPlan(
  llm: LLMClient,
  inputPath: string,
  text: string,
  sourceMap: ReturnType<typeof createDeckSourceMap>,
  options: TextDeckProjectPlanOptions,
  agent: ProjectAgentRuntime | undefined,
): Promise<StagedDeckPlan> {
  const analysis = await runDeckAgentStep(agent, 'understand', 'content-analysis', 'Analyzing source content', () => createContentAnalysis(llm, inputPath, text, sourceMap, options, agent))
  await agent?.completeStage('understand', 'Source understanding complete')
  const brief = await runDeckAgentStep(agent, 'brief', 'deck-brief', 'Writing deck brief', () => generateDeckBrief(llm, inputPath, analysis, options))
  await agent?.completeStage('brief', 'Deck brief complete')
  const effectiveOptions = createEffectiveDeckPlanningOptions(options, brief)
  const slideOutline = await runDeckAgentStep(agent, 'outline', 'slide-outline', 'Planning slide outline', () => generateSlideOutline(llm, inputPath, analysis, brief, effectiveOptions))
  await agent?.completeStage('outline', 'Slide outline complete')
  const slidePlan = await runDeckAgentStep(agent, 'plan-slides', 'slide-plan', 'Designing semantic slide plan', () => generateSlidePlan(llm, inputPath, analysis, brief, slideOutline, effectiveOptions))
  await agent?.completeStage('plan-slides', 'Slide plan complete')
  const scriptSemantics = await runDeckAgentStep(agent, 'script', 'script-semantics', 'Writing script semantics', () => generateScriptSemantics(llm, inputPath, analysis, brief, slideOutline, slidePlan, effectiveOptions))
  const coherenceReview = await runDeckAgentStep(agent, 'script', 'coherence-review', 'Reviewing narrative coherence', () => generateCoherenceReview(llm, inputPath, analysis, brief, slideOutline, slidePlan, scriptSemantics, effectiveOptions))
  await agent?.completeStage('script', 'Script semantics and coherence review complete')

  return {
    analysis,
    brief,
    coherenceReview,
    options: effectiveOptions,
    scriptSemantics,
    slideOutline,
    slidePlan,
  }
}

function createEffectiveDeckPlanningOptions(options: TextDeckProjectPlanOptions, brief: LLMTextDeckBrief): TextDeckProjectPlanOptions {
  return {
    ...options,
    durationTargetSeconds: options.durationTargetSeconds ?? brief.targetDurationSeconds,
    slideCountTarget: options.slideCountTarget ?? brief.targetSlideCount,
  }
}

async function createContentAnalysis(
  llm: LLMClient,
  inputPath: string,
  text: string,
  sourceMap: ReturnType<typeof createDeckSourceMap>,
  options: TextDeckProjectPlanOptions,
  agent: ProjectAgentRuntime | undefined,
): Promise<LLMTextDeckContentAnalysis> {
  const chunks = createDeckPlanningSourceChunks(text, options)
  const analyses = await Promise.all(chunks.map(async (chunk, index) => {
    await agent?.progressStage('understand', {
      current: index + 1,
      message: `Analyzing source chunk ${index + 1}/${chunks.length}`,
      step: 'content-analysis',
      total: chunks.length,
      unit: 'chunks',
    })
    const result = await llm.generateObject(createContentAnalysisRequest(inputPath, chunk, sourceMap, options))

    return result.object
  }))

  if (analyses.length === 1) {
    const analysis = analyses[0]

    if (analysis === undefined) {
      throw new Error('Deck content analysis produced no analysis object.')
    }

    return analysis
  }

  const result = await runDeckAgentStep(agent, 'understand', 'content-analysis-merge', 'Merging content analysis chunks', () => llm.generateObject(createContentAnalysisMergeRequest(inputPath, analyses, options)))

  return result.object
}

async function runDeckAgentStep<T>(
  agent: ProjectAgentRuntime | undefined,
  stage: string,
  step: string,
  message: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (agent === undefined) {
    return fn()
  }

  return agent.runStep({
    fn,
    message,
    stage,
    step,
  })
}

function createContentAnalysisRequest(
  inputPath: string,
  chunk: DeckPlanningSourceChunk,
  sourceMap: ReturnType<typeof createDeckSourceMap>,
  options: TextDeckProjectPlanOptions,
): GenerateObjectRequest<LLMTextDeckContentAnalysis> {
  return createDeckObjectPromptRequest({
    buildMessages: (promptInput) => [createContentAnalysisMessage(promptInput.inputPath, promptInput.chunk, promptInput.sourceMap, promptInput.options)],
    id: 'deck.content-analysis',
    promptInput: {chunk, inputPath, options, sourceMap},
    schema: LLMTextDeckContentAnalysisSchema,
    schemaName: 'LLMTextDeckContentAnalysis',
    stage: 'content-analysis',
    temperature: 0.2,
  })
}

function createContentAnalysisMessage(inputPath: string, chunk: DeckPlanningSourceChunk, sourceMap: ReturnType<typeof createDeckSourceMap>, options: TextDeckProjectPlanOptions): LLMMessage {
  return {
    content: JSON.stringify({
      goal: 'Analyze the source content for a Deck explainer. Return document-level semantic analysis only; do not design slides or write speaker notes.',
      instructions: [
        'Use the final output language explicitly in the language field. If target.language is auto, choose the strongest source/user language from the input.',
        'Remove YAML frontmatter, Markdown syntax, code fences, table pipes, raw template markers, and implementation-only metadata from authored analysis fields.',
        'Infer source structure, coverage, section importance, key claims, caveats, examples, evidence, and output shape from the source.',
        'Use sourceMap.sections ids as the authoritative section ids. Preserve those ids exactly in analysis.sections[].id.',
        'Set mustCover true for source sections that are necessary for a faithful explainer. Do not mark a section optional if omitting it would change the source workflow, caveats, output shape, or quality bar.',
        'Use role to describe the semantic purpose of the source section in a short source-grounded label. Do not use fixed taxonomy values unless they fit the source.',
        'For agent skills, internal instruction documents, methods, or frameworks, preserve workflow, input/output shape, quality bar, validation criteria, caveats, and concrete examples as first-class sections.',
        'When translating or rewriting, preserve the source-domain meaning of technical terms and object nouns. Do not substitute terms from unrelated domains unless the source uses them.',
        'Do not split text by character count for meaning. Merge related source details into coherent source-grounded sections.',
        'Do not author visible slide text, template choices, speaker notes, transitions, motion, or visual style in this stage.',
      ],
      source: {
        chunkId: chunk.chunkId,
        durationSeconds: options.durationTargetSeconds,
        path: inputPath,
        sourceMap,
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

async function generateDeckBrief(
  llm: LLMClient,
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  options: TextDeckProjectPlanOptions,
): Promise<LLMTextDeckBrief> {
  const result = await llm.generateObject(createDeckBriefRequest(inputPath, analysis, options))

  return result.object
}

function createDeckBriefRequest(
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  options: TextDeckProjectPlanOptions,
): GenerateObjectRequest<LLMTextDeckBrief> {
  return createDeckObjectPromptRequest({
    buildMessages: (promptInput) => [{
      content: JSON.stringify({
        analysis: promptInput.analysis,
        goal: 'Create a presentation brief for a Deck explainer. Decide coverage strategy, target slide count, narrative arc, density policy, and required source sections. Do not write slide text or narration.',
        instructions: [
          'Base requiredSectionIds on analysis.sections where mustCover is true. Preserve section ids exactly.',
          'If target.slideCount.target is provided, set targetSlideCount exactly to that value.',
          'If target.slideCount.target is absent, choose targetSlideCount from source complexity, required sections, target.contentDensity, and target duration.',
          'Never exceed target.slideCount.maximum, and keep targetSlideCount large enough that must-cover sections are not compressed into unrelated slides.',
          'Always set targetDurationSeconds. If target.durationSeconds is provided, copy it exactly. If it is absent, infer a realistic explainer duration from source complexity, targetSlideCount, target.contentDensity, and the amount of actionable detail required.',
          'For procedural sources, output templates, code/config examples, checklists, caveats, or validation criteria, choose enough slides and duration for a viewer to understand the practical workflow, not just the headline.',
          'Describe a narrativeArc that can guide slide ordering without writing slide titles.',
          'Write densityPolicy as concrete generation guidance that follows target.contentDensity while preserving source-grounded coverage.',
        ],
        inputPath: promptInput.inputPath,
        stage: 'deck-brief',
        target: createDeckPlanningTarget(promptInput.options, {includeTemplateManifest: false}),
      }),
      role: 'user',
    }],
    id: 'deck.brief',
    promptInput: {analysis, inputPath, options},
    schema: LLMTextDeckBriefSchema,
    schemaName: 'LLMTextDeckBrief',
    stage: 'deck-brief',
    temperature: 0.2,
  })
}

async function generateSlideOutline(
  llm: LLMClient,
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  brief: LLMTextDeckBrief,
  options: TextDeckProjectPlanOptions,
  rewrite?: {
    attemptsRemaining: number
    invalidOutput: LLMTextDeckSlideOutline
    issues: DeckPlanningValidationIssue[]
  },
): Promise<LLMTextDeckSlideOutline> {
  const result = await llm.generateObject(createSlideOutlineRequest(inputPath, analysis, brief, options, rewrite))

  return result.object
}

function createSlideOutlineRequest(
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  brief: LLMTextDeckBrief,
  options: TextDeckProjectPlanOptions,
  rewrite?: {
    attemptsRemaining: number
    invalidOutput: LLMTextDeckSlideOutline
    issues: DeckPlanningValidationIssue[]
  },
): GenerateObjectRequest<LLMTextDeckSlideOutline> {
  const baseMessage: LLMMessage = {
    content: JSON.stringify({
      analysis,
      brief,
      goal: 'Create a slide outline for the Deck explainer. Decide what each slide covers before any visible slide text is written.',
      instructions: [
        'Every brief.requiredSectionIds entry must appear in at least one slides[].sourceSectionIds array.',
        'If target.slideCount.target is provided, return exactly that many outline slides.',
        'If target.slideCount.target is absent, keep outline slide count within target.slideCount.minimum and target.slideCount.maximum while following brief.targetSlideCount.',
        'Use one outline slide for one coherent idea. Split unrelated required sections instead of combining them.',
        'Set narrationBudgetSeconds as a pacing weight based on target duration, target.contentDensity, and slide goal; it is not a field-level speakerNote limit.',
        'Allocate nearly all of target.durationSeconds across slides. Dense slides may receive more time when simpler slides receive less time.',
        'For workflows with many steps, output templates with many fields, code/config examples, or validation criteria, preserve structure by assigning multiple slides instead of compressing everything into a single summary card.',
        'For detailed content density, prefer adding a coherent slide within target.slideCount.maximum over compressing necessary examples, steps, caveats, or evidence into one slide.',
        'templateIntent must be one registered template type and should match the information role and source content.',
        'visualIntent should describe the visual job of the slide without CSS, fonts, or coordinates.',
      ],
      inputPath,
      stage: 'slide-outline',
      target: createDeckPlanningTarget(options, {includeTemplateManifest: true}),
    }),
    role: 'user',
  }

  const messages = rewrite === undefined
    ? [baseMessage]
    : [
        baseMessage,
        {
          content: JSON.stringify({
            invalidOutput: rewrite.invalidOutput,
            issues: rewrite.issues,
            stage: 'slide-outline',
          }),
          role: 'assistant' as const,
        },
        {
          content: JSON.stringify({
            attemptsRemaining: rewrite.attemptsRemaining,
            goal: 'Rewrite the slide-outline stage output so it satisfies the structured validation issues. Return a complete replacement slide-outline object, not a patch.',
            instructions: [
              'Use issues as binding coverage and outline feedback.',
              'If an issue includes repairStrategy, requiredAdditions, forbiddenFixes, repeatCount, or escalationReason, treat those fields as binding repair contract. Address each requiredAdditions item directly and avoid every forbiddenFixes item.',
              'Respect target.slideCount exactly when target.slideCount.target is provided; otherwise keep the outline within target.slideCount.minimum and target.slideCount.maximum.',
              'Every brief.requiredSectionIds entry and every mustCover analysis section must appear in at least one slides[].sourceSectionIds array.',
              'If a slide covers too many unrelated source sections, split it into multiple coherent outline slides instead of compressing them.',
              'Preserve source section ids exactly; do not invent ids that are absent from analysis.sections or brief required/optional ids.',
              'Keep narrationBudgetSeconds realistic for the slide goal and total target duration; rebalance timing across the outline instead of treating one slide budget as a hard cap.',
              'Do not write visible slide text, speaker notes, transitions, motion, or semantic metadata in this stage.',
            ],
            issues: rewrite.issues,
          }),
          role: 'user' as const,
        },
      ]

  return createDeckObjectPromptRequest({
    buildMessages: () => messages,
    id: 'deck.slide-outline',
    promptInput: {analysis, brief, inputPath, options, rewrite},
    schema: LLMTextDeckSlideOutlineSchema,
    schemaName: 'LLMTextDeckSlideOutline',
    stage: 'slide-outline',
    temperature: 0.2,
  })
}

function createContentAnalysisMergeRequest(
  inputPath: string,
  analyses: LLMTextDeckContentAnalysis[],
  options: TextDeckProjectPlanOptions,
): GenerateObjectRequest<LLMTextDeckContentAnalysis> {
  const baseMessage: LLMMessage = {
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
  }

  return createDeckObjectPromptRequest({
    buildMessages: () => [baseMessage],
    id: 'deck.content-analysis-merge',
    promptInput: {analyses, inputPath, options},
    schema: LLMTextDeckContentAnalysisSchema,
    schemaName: 'LLMTextDeckContentAnalysis',
    stage: 'content-analysis-merge',
    temperature: 0.2,
  })
}

async function generateSlidePlan(
  llm: LLMClient,
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  brief: LLMTextDeckBrief,
  slideOutline: LLMTextDeckSlideOutline,
  options: TextDeckProjectPlanOptions,
  rewrite?: {
    attemptsRemaining: number
    invalidOutput: LLMTextDeckSlidePlan
    issues: DeckPlanningValidationIssue[]
  },
): Promise<LLMTextDeckSlidePlan> {
  const result = await llm.generateObject(createSlidePlanRequest(inputPath, analysis, brief, slideOutline, options, rewrite))

  return result.object
}

function createSlidePlanRequest(
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  brief: LLMTextDeckBrief,
  slideOutline: LLMTextDeckSlideOutline,
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
      brief,
      goal: 'Turn the approved slide outline into PPT-style slide data. Return slide structure, visible text, template data, visuals, motion, and transitions only.',
      instructions: [
        'Return exactly one slide-plan slide for each slideOutline.slides item, preserving outlineId and sourceSectionIds as sectionIds.',
        'Use requiredSlides as the binding checklist: return exactly one slides[] entry for every requiredSlides item, preserving outlineId values and slide order.',
        'Use slideOutline.templateIntent as the default slide type unless the template manifest makes a different controlled template clearly better.',
        'Use target.contentDensity.visibleTextPolicy to choose how much visible detail to include, while respecting every template field limit and target.maxVisibleCharactersPerSlide.',
        'Choose slide type only from target.templateManifest.templates. Do not invent, rename, or translate type values.',
        'For visual.kind, choose one of chart, code, process, table, text, or title-card. Return assetRefs as an empty array.',
        'When target.requiredSlideTypes is provided, include every listed slide type at least once.',
        'Required code slides must include a non-empty code field, and required process slides must use the process type with concrete process.steps.',
        'For process slides, fill process.steps with 2-7 ordered steps. Use label for the step name and detail for observable inputs, metrics, thresholds, decision branches, examples, or falsification criteria. points may stay empty or hold only a short slide-level summary.',
        'Preserve the slideOutline slide count exactly. If content cannot fit a template, validation will route the fix back to slide-outline rather than asking this stage to invent extra slides.',
        'If content exceeds a template limit, select a better registered template or keep only source-critical visible text; do not add slides in this stage.',
        'Do not put multiple unrelated themes on one slide; split by topic before choosing a template.',
        'For workflow, checklist, validation, scoring, risk, sizing, and output-template slides, visible fields must carry the operational method: concrete observable inputs, metrics, thresholds, decision branches, examples, or falsification conditions from the source.',
        'Do not hide practical detail only in speakerNote or semantic metadata. If a viewer needs the detail to apply the method, put it in points, process.steps, comparison, chart, stat, code.text, or another visible structured field.',
        'For verification-chain slides, include visible checkpoints such as revenue/guidance, backlog/orders, margin/mix, utilization/capacity, management commentary, and at least one confirm/weaken/falsify condition when the source supports it.',
        'For scoring slides, visible fields must show how to assign scores: include the scale meaning such as 1=weak/5=strong when the source uses a 1-5 scale, the concrete scoring dimensions, and how score bands change priority or next action.',
        'For position-sizing slides, show the visible mapping from evidence state or score band to next action; do not only say "score" or "conditional sizing".',
        'For output-template slides, replace placeholders with short filled examples or field-specific instructions so the viewer can see what each report section should contain.',
        'When the source contains code fences, shell commands, configuration snippets, API examples, or code_sample references, include at least one code slide that preserves a short representative snippet in code.text.',
        'For code slides, remove Markdown fences and raw template markers from visible text, but preserve the executable command, configuration, request, response, or schema content needed by the viewer.',
        'For explainer decks with more than three slides, end with a summary slide that restates the main takeaways and next practical action.',
        'Only use comparison, stat, chart, quote, or code when the matching structured field is complete.',
        'Return transitionOut for every slide. For the final slide, set transitionOut to null.',
        'Choose motion only from controlled presets; do not describe CSS, colors, fonts, or absolute positions.',
      ],
      inputPath,
      requiredSlides: createSlidePlanRequiredSlides(slideOutline),
      slideOutline,
      stage: 'slide-plan',
      target: createDeckPlanningTarget(options, {includeTemplateManifest: true}),
    }),
    role: 'user',
  }

  const messages = rewrite === undefined
    ? [baseMessage]
    : [
        baseMessage,
        {
          content: JSON.stringify({
            invalidOutput: rewrite.invalidOutput,
            issues: rewrite.issues,
            stage: 'slide-plan',
          }),
          role: 'assistant' as const,
        },
        {
          content: JSON.stringify({
            attemptsRemaining: rewrite.attemptsRemaining,
            goal: 'Rewrite the slide-plan stage output so it satisfies the structured validation issues. Return a complete replacement slide-plan object, not a patch.',
            instructions: [
              'Use issues as binding field-level feedback.',
              'Resolve every issue in the issues array before returning; do not stop after fixing only the first issue.',
              'If an issue includes repairStrategy, requiredAdditions, forbiddenFixes, repeatCount, or escalationReason, treat those fields as binding repair contract. Address each requiredAdditions item directly and avoid every forbiddenFixes item.',
              'Before returning, count every generated title, subtitle, point, process step label/detail, comparison point, and chart label with JavaScript string length semantics and ensure each value is within its listed issue.limit and the target.templateManifest limit.',
              'Only change slide structure, visible text, template data, visual kind, motion, theme, platform, and transition choices needed to satisfy the issues.',
              'For LOW_INFORMATION_DEPTH and MISSING_PRACTICAL_DETAIL issues, repair the visible slide-plan fields directly. Do not rely on speakerNote, scriptSemantics, semantic metadata, or later narration to carry the missing operational detail.',
              'For scoring-detail repairs, the returned visible fields must include the score scale meaning, named dimensions, and a score-band or evidence-state mapping to priority, watchlist, small test, add, reduce, or exit.',
              'If points cannot hold the needed detail, switch to a registered structured template such as process, comparison, chart, code, summary, or three-points and fill its visible structured data completely. For process, repair process.steps rather than expanding points.',
              'When attemptsRemaining is 0, also scan all workflow, validation, scoring, sizing, quality, and output-template slides for the same missing-practical-detail pattern and fix them proactively before returning.',
              'Keep source-grounded meaning and required slide types.',
              'Do not write speaker notes, source ranges, outline, or semantic metadata in this stage.',
            ],
            issues: rewrite.issues,
          }),
          role: 'user' as const,
        },
      ]

  return createDeckObjectPromptRequest({
    buildMessages: () => messages,
    id: 'deck.slide-plan',
    promptInput: {analysis, brief, inputPath, options, rewrite, slideOutline},
    schema: createExactSlidePlanSchema(slideOutline),
    schemaName: 'LLMTextDeckSlidePlan',
    stage: 'slide-plan',
    temperature: 0.2,
  })
}

function createExactSlidePlanSchema(slideOutline: LLMTextDeckSlideOutline) {
  return LLMTextDeckSlidePlanSchema.extend({
    slides: LLMTextDeckSlidePlanSchema.shape.slides.length(slideOutline.slides.length),
  })
}

function createSlidePlanRequiredSlides(slideOutline: LLMTextDeckSlideOutline): Array<{
  goal: string
  outlineId: string
  slideIndex: number
}> {
  return slideOutline.slides.map((slide, index) => ({
    goal: slide.goal,
    outlineId: slide.outlineId,
    slideIndex: index,
  }))
}

async function generateScriptSemantics(
  llm: LLMClient,
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  brief: LLMTextDeckBrief,
  slideOutline: LLMTextDeckSlideOutline,
  slidePlan: LLMTextDeckSlidePlan,
  options: TextDeckProjectPlanOptions,
  rewrite?: {
    attemptsRemaining: number
    invalidOutput: LLMTextDeckScriptSemantics
    issues: DeckPlanningValidationIssue[]
  },
): Promise<LLMTextDeckScriptSemantics> {
  const result = await llm.generateObject(createScriptSemanticsRequest(inputPath, analysis, brief, slideOutline, slidePlan, options, rewrite))

  return result.object
}

function createScriptSemanticsRequest(
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  brief: LLMTextDeckBrief,
  slideOutline: LLMTextDeckSlideOutline,
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
      brief,
      goal: 'Write narration, slide semantic metadata, source ranges, durations, and outline for the approved slide plan.',
      instructions: [
        'Return one scriptSemantics slide entry per slidePlan slide, using matching zero-based slideIndex values.',
        'Use requiredSlides as the binding checklist: return exactly one slides[] entry for every requiredSlides item, preserving slideIndex values and slide order.',
        'Use slideOutline.slides[].narrationBudgetSeconds and scriptTimingBudgets as pacing guidance, not per-slide hard limits.',
        'Keep total estimated narration close to the deck target duration. A dense slide may run longer than its outline budget if simpler slides run shorter.',
        'Use scriptTimingBudgets suggestedSpeakerNoteCharacters or suggestedSpeakerNoteWords to choose approximate density; these are guidance values, not validation caps.',
        'Set each slide duration to the expected spoken length and make all slide durations sum to target.durationSeconds when target.durationSeconds is present.',
        'Write one natural speakerNote per slide for TTS. It should sound like a presenter guiding the viewer through the slide, not a file reader.',
        'Use target.contentDensity.narrationPolicy to choose how much explanatory detail to include in speakerNote while keeping the whole deck paced realistically.',
        'The speakerNote must walk the viewer through the on-screen content in order and expand each visible point into a natural spoken sentence.',
        'Do not introduce new arguments, examples, claims, or steps that are not visible on the current slide, except brief transition phrases.',
        'For comparison slides, describe both sides. For code slides, briefly explain each visible section. For stat, quote, and chart slides, mention the displayed value, quote, or chart takeaway.',
        'For semantic.blockType, choose claim, context, data, example, quote, recommendation, or summary.',
        'Always return semantic.claim explicitly. Use null only when the slide should not create a claim artifact.',
        'Return calibrated semantic.claim.confidence and semantic.momentScore numbers from 0 to 1.',
        'For semantic.sourceQuoteText, choose or paraphrase the most relevant source-backed evidence for the slide.',
        'Keep semantic.blockText, semantic.momentReason, semantic.momentSummary, semantic.visualStyle, and semantic.claim.text as single-line text with no newlines, tabs, Markdown bullets, table pipes, or repeated spaces.',
        'semantic.sourceQuoteText is evidence, not visible text: keep it non-empty and source-grounded, and preserve source Markdown/table/code syntax when it is the most relevant evidence.',
        'When source transcript segments are available, choose sourceRange from timed transcript evidence.',
        'For markdown or text sources, sourceRange is the planned presentation timeline range in seconds, not a source character offset. When requiredSlides[].sourceRangeHint is present, copy its range exactly into slides[].sourceRange.',
        'Never return a placeholder or zero-length sourceRange such as [0,0]; sourceRange must always have end greater than start.',
        'Return outline with exactly one section per slide in slide order.',
      ],
      inputPath,
      requiredSlides: createScriptSemanticsRequiredSlides(slideOutline, slidePlan, options),
      scriptTimingBudgets: createScriptTimingBudgets(slideOutline, slidePlan, options),
      slidePlan,
      slideOutline,
      source: {
        durationSeconds: options.durationTargetSeconds,
        sourceType: requireDeckPlanningSourceType(options.sourceType),
      },
      stage: 'script-semantics',
      target: createDeckPlanningTarget(options, {includeTemplateManifest: false}),
    }),
    role: 'user',
  }

  const messages = rewrite === undefined
    ? [baseMessage]
    : [
        baseMessage,
        {
          content: JSON.stringify({
            invalidOutput: rewrite.invalidOutput,
            issues: rewrite.issues,
            stage: 'script-semantics',
          }),
          role: 'assistant' as const,
        },
        {
          content: JSON.stringify({
            attemptsRemaining: rewrite.attemptsRemaining,
            goal: 'Rewrite the script-semantics stage output so it satisfies the structured validation issues. Return a complete replacement script-semantics object, not a patch.',
            instructions: [
              'Use issues as binding field-level feedback.',
              'Resolve every issue in the issues array before returning; do not stop after fixing only the first issue.',
              'If an issue includes repairStrategy, requiredAdditions, forbiddenFixes, repeatCount, or escalationReason, treat those fields as binding repair contract. Address each requiredAdditions item directly and avoid every forbiddenFixes item.',
              'Only change speaker notes, durations, source ranges, outline, and semantic metadata needed to satisfy the issues.',
              'For aggregate timing issues, rebalance narration detail and slide durations across the whole deck; do not shrink only the first reported slide.',
              'For LOW_INFORMATION_DEPTH, MISSING_PRACTICAL_DETAIL, and COHERENCE_GAP repairs, speakerNote and semantic fields must add concrete operational criteria, examples, or transition logic named by the issue; repeating existing visible points is not a valid repair.',
              'Keep all slidePlan visible text, template data, motion, visual, and transition choices unchanged.',
              'Do not ask the runtime to infer, clip, shorten, or repair semantic content.',
            ],
            issues: rewrite.issues,
          }),
          role: 'user' as const,
        },
      ]

  return createDeckObjectPromptRequest({
    buildMessages: () => messages,
    id: 'deck.script-semantics',
    promptInput: {analysis, brief, inputPath, options, rewrite, slideOutline, slidePlan},
    schema: createExactScriptSemanticsSchema(slidePlan),
    schemaName: 'LLMTextDeckScriptSemantics',
    stage: 'script-semantics',
    temperature: 0.2,
  })
}

function createExactScriptSemanticsSchema(slidePlan: LLMTextDeckSlidePlan) {
  return LLMTextDeckScriptSemanticsSchema.extend({
    slides: LLMTextDeckScriptSemanticsSchema.shape.slides.length(slidePlan.slides.length),
  })
}

function createScriptSemanticsRequiredSlides(
  slideOutline: LLMTextDeckSlideOutline,
  slidePlan: LLMTextDeckSlidePlan,
  options: TextDeckProjectPlanOptions,
): Array<{
  outlineId: string
  sourceRangeHint: {
    basis: 'planned-presentation-timeline'
    range: [number, number]
    unit: 'seconds'
  }
  sourceSectionIds: string[]
  slideIndex: number
  title: string
}> {
  const rangeHints = createScriptTimelineRangeHints(slideOutline, slidePlan, options)

  return slidePlan.slides.map((slide, index) => {
    const outlineSlide = slideOutline.slides[index]
    const sourceSectionIds = uniqueStrings([
      ...slide.sectionIds,
      ...(outlineSlide?.sourceSectionIds ?? []),
    ])
    const sourceRangeHint = rangeHints[index] ?? {
      basis: 'planned-presentation-timeline' as const,
      range: [index, index + 1] as [number, number],
      unit: 'seconds' as const,
    }

    return {
      outlineId: slide.outlineId,
      sourceRangeHint,
      sourceSectionIds,
      slideIndex: index,
      title: slide.title,
    }
  })
}

function createScriptTimelineRangeHints(
  slideOutline: LLMTextDeckSlideOutline,
  slidePlan: LLMTextDeckSlidePlan,
  options: TextDeckProjectPlanOptions,
): Array<{basis: 'planned-presentation-timeline'; range: [number, number]; unit: 'seconds'}> {
  const rawDurations = slidePlan.slides.map((slide, index) => {
    const outlineDuration = slideOutline.slides[index]?.narrationBudgetSeconds

    return Math.max(0.001, outlineDuration ?? slide.durationIntent)
  })
  const rawTotal = rawDurations.reduce((sum, duration) => sum + duration, 0)
  const targetTotal = options.durationTargetSeconds ?? rawTotal
  const scale = rawTotal > 0 ? targetTotal / rawTotal : 1
  let cursor = 0

  return rawDurations.map((duration, index) => {
    const start = roundTimelineSeconds(cursor)
    cursor += duration * scale
    const isLast = index === rawDurations.length - 1
    const end = roundTimelineSeconds(isLast ? targetTotal : cursor)

    return {
      basis: 'planned-presentation-timeline',
      range: end > start ? [start, end] : [start, roundTimelineSeconds(start + 0.001)],
      unit: 'seconds',
    }
  })
}

function roundTimelineSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function createScriptTimingBudgets(
  slideOutline: LLMTextDeckSlideOutline,
  slidePlan: LLMTextDeckSlidePlan,
  options: TextDeckProjectPlanOptions,
): Array<{
  budgetSeconds: number
  outlineId: string
  slideIndex: number
  suggestedSpeakerNoteCharacters?: number
  suggestedSpeakerNoteWords?: number
  title: string
}> {
  const useCjkBudget = isCjkLanguage(options.language)

  return slidePlan.slides.map((slide, index) => {
    const outlineSlide = slideOutline.slides[index]
    const budgetSeconds = outlineSlide?.narrationBudgetSeconds ?? slide.durationIntent

    return {
      budgetSeconds,
      ...(useCjkBudget
        ? {suggestedSpeakerNoteCharacters: speakerNoteCharactersForSeconds(budgetSeconds)}
        : {}),
      ...(!useCjkBudget
        ? {suggestedSpeakerNoteWords: speakerNoteWordsForSeconds(budgetSeconds)}
        : {}),
      outlineId: slide.outlineId,
      slideIndex: index,
      title: slide.title,
    }
  })
}

function validateLLMTextDeckSlideCount(
  slideOutline: LLMTextDeckSlideOutline,
  options: TextDeckProjectPlanOptions,
): void {
  const slideCount = createDeckPlanningIntent(options).slideCount
  const actual = slideOutline.slides.length
  const issues: LLMTextDeckValidationIssue[] = []

  if (actual < slideCount.minimum) {
    issues.push({
      actual,
      code: 'SLIDE_COUNT_MINIMUM',
      field: 'slides',
      limit: slideCount.minimum,
      message: `Deck slide outline has ${actual} slides, below minimum slide count ${slideCount.minimum}.`,
      path: 'slideOutline.slides',
      stage: 'slide-outline',
    })
  }

  if (actual > slideCount.maximum) {
    issues.push({
      actual,
      code: 'SLIDE_COUNT_MAXIMUM',
      field: 'slides',
      limit: slideCount.maximum,
      message: `Deck slide outline has ${actual} slides, exceeding maximum slide count ${slideCount.maximum}.`,
      path: 'slideOutline.slides',
      stage: 'slide-outline',
    })
  }

  if (slideCount.target !== undefined && actual !== slideCount.target) {
    issues.push({
      actual,
      code: 'SLIDE_COUNT_TARGET',
      field: 'slides',
      limit: slideCount.target,
      message: `Deck slide outline has ${actual} slides, but target slide count is ${slideCount.target}.`,
      path: 'slideOutline.slides',
      stage: 'slide-outline',
    })
  }

  if (issues.length > 0) {
    throw new LLMTextDeckValidationError(issues)
  }
}

function validateLLMTextDeckScriptSemanticsStructure(
  scriptSemantics: LLMTextDeckScriptSemantics,
  slideOutline: LLMTextDeckSlideOutline,
): void {
  validateLLMTextDeckScriptSemanticsCardinality(scriptSemantics, slideOutline)
  validateLLMTextDeckScriptSemanticsText(scriptSemantics)
}

function validateLLMTextDeckSlidePlanStructure(
  slidePlan: LLMTextDeckSlidePlan,
  slideOutline: LLMTextDeckSlideOutline,
): void {
  const expected = slideOutline.slides.length
  const issues: LLMTextDeckValidationIssue[] = []

  if (slidePlan.slides.length !== expected) {
    issues.push({
      actual: slidePlan.slides.length,
      code: 'SLIDE_PLAN_CARDINALITY',
      field: 'slides',
      limit: expected,
      message: `Deck slide-plan stage must return exactly one entry per slide-outline slide; got ${slidePlan.slides.length} for ${expected}.`,
      path: 'slidePlan.slides',
      stage: 'slide-plan',
    })
  }

  for (let index = 0; index < Math.min(slidePlan.slides.length, expected); index += 1) {
    const expectedOutlineId = slideOutline.slides[index]?.outlineId
    const actualOutlineId = slidePlan.slides[index]?.outlineId

    if (expectedOutlineId === undefined || actualOutlineId === expectedOutlineId) {
      continue
    }

    issues.push({
      code: 'SLIDE_PLAN_OUTLINE_ID_MISMATCH',
      field: 'outlineId',
      message: `Deck slide-plan slide ${index + 1} must preserve slide-outline outlineId "${expectedOutlineId}", got "${actualOutlineId}".`,
      path: `slidePlan.slides[${index}].outlineId`,
      slideIndex: index,
      stage: 'slide-plan',
    })
    break
  }

  if (issues.length > 0) {
    throw new LLMTextDeckValidationError(issues)
  }
}

function validateLLMTextDeckScriptSemanticsCardinality(
  scriptSemantics: LLMTextDeckScriptSemantics,
  slideOutline: LLMTextDeckSlideOutline,
): void {
  const expected = slideOutline.slides.length
  const slideIndexes = new Set(scriptSemantics.slides.map((slide) => slide.slideIndex))
  const issues: LLMTextDeckValidationIssue[] = []

  if (slideIndexes.size !== expected || scriptSemantics.slides.length !== expected) {
    issues.push({
      actual: scriptSemantics.slides.length,
      code: 'SCRIPT_SEMANTICS_CARDINALITY',
      field: 'slides',
      limit: expected,
      message: `Deck script-semantics stage must return exactly one entry per slide-outline slide; got ${scriptSemantics.slides.length} for ${expected}.`,
      path: 'scriptSemantics.slides',
      stage: 'script-semantics',
    })
  } else {
    for (let index = 0; index < expected; index += 1) {
      if (slideIndexes.has(index)) {
        continue
      }

      issues.push({
        actual: scriptSemantics.slides.length,
        code: 'SCRIPT_SEMANTICS_CARDINALITY',
        field: 'slideIndex',
        limit: expected,
        message: `Deck script-semantics stage is missing slideIndex ${index}.`,
        path: 'scriptSemantics.slides',
        slideIndex: index,
        stage: 'script-semantics',
      })
      break
    }
  }

  if (issues.length > 0) {
    throw new LLMTextDeckValidationError(issues)
  }
}

function validateLLMTextDeckScriptSemanticsText(scriptSemantics: LLMTextDeckScriptSemantics): void {
  const issues: LLMTextDeckValidationIssue[] = []

  scriptSemantics.slides.forEach((slide) => {
    collectCleanScriptSemanticTextIssue(issues, slide.semantic.blockText, 'semantic.blockText', `scriptSemantics.slides[${slide.slideIndex}].semantic.blockText`, slide.slideIndex)
    collectCleanScriptSemanticTextIssue(issues, slide.semantic.momentReason, 'semantic.momentReason', `scriptSemantics.slides[${slide.slideIndex}].semantic.momentReason`, slide.slideIndex)
    collectCleanScriptSemanticTextIssue(issues, slide.semantic.momentSummary, 'semantic.momentSummary', `scriptSemantics.slides[${slide.slideIndex}].semantic.momentSummary`, slide.slideIndex)
    collectCleanScriptSemanticTextIssue(issues, slide.semantic.visualStyle, 'semantic.visualStyle', `scriptSemantics.slides[${slide.slideIndex}].semantic.visualStyle`, slide.slideIndex)

    if (slide.semantic.claim !== null) {
      collectCleanScriptSemanticTextIssue(issues, slide.semantic.claim.text, 'semantic.claim.text', `scriptSemantics.slides[${slide.slideIndex}].semantic.claim.text`, slide.slideIndex)
    }
  })

  if (issues.length > 0) {
    throw new LLMTextDeckValidationError(issues)
  }
}

function collectCleanScriptSemanticTextIssue(
  issues: LLMTextDeckValidationIssue[],
  value: string,
  field: string,
  path: string,
  slideIndex: number,
): void {
  try {
    assertNoGeneratedTextControlSyntax(value, `slide ${slideIndex + 1} ${field}`)
    cleanGeneratedText(value, `slide ${slideIndex + 1} ${field}`)
  } catch (error) {
    issues.push({
      code: 'SCRIPT_TEXT_FIELD_CLEANLINESS',
      field,
      message: formatErrorMessage(error),
      path,
      slideIndex,
      stage: 'script-semantics',
    })
  }
}

function validateLLMTextDeckScriptSemanticsTiming(
  scriptSemantics: LLMTextDeckScriptSemantics,
  slideOutline: LLMTextDeckSlideOutline,
  options: TextDeckProjectPlanOptions,
): void {
  const issues: LLMTextDeckValidationIssue[] = []
  const plannedDuration = scriptSemantics.slides.reduce((sum, slide) => sum + slide.duration, 0)
  const targetDuration = options.durationTargetSeconds
  const estimatedSpeechDuration = scriptSemantics.slides.reduce((sum, slide) => sum + estimateSpeakerNoteSeconds(slide.speakerNote, options.language), 0)
  const outlineBudgetDuration = slideOutline.slides.reduce((sum, slide) => sum + slide.narrationBudgetSeconds, 0)
  const timingPlanDuration = targetDuration ?? (plannedDuration > 0 ? plannedDuration : outlineBudgetDuration)

  if (
    timingPlanDuration > 0
    && estimatedSpeechDuration / timingPlanDuration > DECK_LLM_TOTAL_TIMING_ESTIMATE_TO_PLAN_RATIO
    && estimatedSpeechDuration - timingPlanDuration > DECK_LLM_TOTAL_TIMING_GRACE_SECONDS
  ) {
    issues.push({
      actual: roundTimingIssueValue(estimatedSpeechDuration),
      code: 'SCRIPT_TIMING_TOTAL_BUDGET',
      field: 'speakerNote',
      limit: roundTimingIssueValue(timingPlanDuration * DECK_LLM_TOTAL_TIMING_ESTIMATE_TO_PLAN_RATIO),
      message: `Script semantics estimated total narration is ${roundTimingIssueValue(estimatedSpeechDuration)}s, exceeding aggregate timing tolerance for planned ${roundTimingIssueValue(timingPlanDuration)}s. Rebalance narration across the full deck instead of enforcing per-slide caps.`,
      path: 'scriptSemantics.slides[].speakerNote',
      stage: 'script-semantics',
    })
  }

  if (issues.length > 0) {
    throw new LLMTextDeckValidationError(issues)
  }
}

function speakerNoteCharactersForSeconds(seconds: number): number {
  return Math.max(1, Math.floor(seconds * DECK_LLM_CJK_CHARACTERS_PER_SECOND))
}

function speakerNoteWordsForSeconds(seconds: number): number {
  return Math.max(1, Math.floor(seconds * DECK_LLM_ENGLISH_WORDS_PER_SECOND))
}

function estimateSpeakerNoteSeconds(text: string, language: string): number {
  if (isCjkLanguage(language) || containsCjk(text)) {
    return Math.max(1, countCjkAwareCharacters(text) / DECK_LLM_CJK_CHARACTERS_PER_SECOND)
  }

  return Math.max(1, countWords(text) / DECK_LLM_ENGLISH_WORDS_PER_SECOND)
}

function roundTimingIssueValue(value: number): number {
  return Math.round(value * 100) / 100
}

async function generateCoherenceReview(
  llm: LLMClient,
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  brief: LLMTextDeckBrief,
  slideOutline: LLMTextDeckSlideOutline,
  slidePlan: LLMTextDeckSlidePlan,
  scriptSemantics: LLMTextDeckScriptSemantics,
  options: TextDeckProjectPlanOptions,
  previousIssues: LLMTextDeckCoherenceReview['issues'] = [],
): Promise<LLMTextDeckCoherenceReview> {
  const result = await llm.generateObject(createCoherenceReviewRequest(inputPath, analysis, brief, slideOutline, slidePlan, scriptSemantics, options, previousIssues))

  return normalizeCoherenceReview(result.object, previousIssues)
}

function normalizeCoherenceReview(
  review: LLMTextDeckCoherenceReview,
  previousIssues: LLMTextDeckCoherenceReview['issues'],
): LLMTextDeckCoherenceReview {
  const previousWarningKeys = new Set(previousIssues
    .filter((issue) => normalizedCoherenceIssueSeverity(issue) === 'warning')
    .map(createCoherenceIssueRepeatKey))

  if (previousWarningKeys.size === 0) {
    return review
  }

  return {
    ...review,
    issues: review.issues.map((issue) => previousWarningKeys.has(createCoherenceIssueRepeatKey(issue))
      ? {
          ...issue,
          severity: 'warning' as const,
        }
      : issue),
  }
}

function createCoherenceIssueRepeatKey(issue: LLMTextDeckCoherenceReview['issues'][number]): string {
  return [
    issue.code,
    issue.slideIndex ?? 'global',
    issue.path ?? 'no-path',
    issue.stage,
  ].join('|')
}

function createCoherenceReviewRequest(
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  brief: LLMTextDeckBrief,
  slideOutline: LLMTextDeckSlideOutline,
  slidePlan: LLMTextDeckSlidePlan,
  scriptSemantics: LLMTextDeckScriptSemantics,
  options: TextDeckProjectPlanOptions,
  previousIssues: LLMTextDeckCoherenceReview['issues'],
): GenerateObjectRequest<LLMTextDeckCoherenceReview> {
  const baseMessage: LLMMessage = {
    content: JSON.stringify({
      analysis,
      brief,
      goal: 'Review the generated Deck plan before artifact build. Find semantic continuity, pacing, depth, and template-variety issues that would reduce viewer comprehension.',
      instructions: [
        'Return issues only when a specific stage should rewrite output. Do not report vague style preferences.',
        'Check narrative continuity: each slide should follow from the previous slide and set up the next slide when the source is procedural.',
        'Check practical depth: sections that contain commands, setup details, examples, tables, validation criteria, or output templates should preserve enough actionable detail for a viewer to use them.',
        'In the first review pass, enumerate every slide-plan visible-text LOW_INFORMATION_DEPTH or MISSING_PRACTICAL_DETAIL issue you can find in workflow, validation, scoring, sizing, quality, and output-template slides. Do not hold similar practical-detail issues for later review rounds.',
        'When a later review follows a rewrite, do not introduce a new LOW_INFORMATION_DEPTH or MISSING_PRACTICAL_DETAIL error for a slide that already had the same visible-text defect in the prior plan; report it in the earliest responsible pass.',
        'Use previousIssues to distinguish unresolved prior defects from newly introduced defects. Do not drip-feed same-pattern visible-detail issues across review rounds.',
        'If operational detail appears only in speakerNote or semantic metadata while the visible slide-plan text stays abstract, report the issue against slide-plan, because the viewer cannot see the method.',
        'For process slides, review process.steps as the visible flowchart content. Do not treat empty points as a defect when process.steps carries concrete ordered labels and details.',
        'For scoring slides, consider the visible text sufficient only when it includes the scoring scale meaning, named dimensions, and the decision or priority mapping produced by the score.',
        'Report LOW_INFORMATION_DEPTH or MISSING_PRACTICAL_DETAIL as severity error when the issue affects a must-cover section, workflow step sequence, output template, code/config example, validation criterion, or required caveat.',
        'Check timing realism at deck level: total slide durations and total estimated speakerNote duration should be close to target.durationSeconds. Per-slide budget mismatches are warnings unless they break narrative comprehension.',
        'Do not force every speakerNote to fit its outline narrationBudgetSeconds. Prefer aggregate pacing: dense slides may be longer when simple slides are shorter.',
        'Check template variety: do not use repeated one-big-idea/summary cards when process, table, code, comparison, stat, quote, or chart would make the source structure clearer.',
        'For each issue choose the earliest responsible stage: slide-outline for coverage/order/budget/template intent, slide-plan for visible text/template choice, script-semantics for narration/duration/semantic metadata.',
        'Use severity error only when rewrite is required before artifact build; use warning for reviewable quality concerns.',
      ],
      inputPath,
      previousIssues,
      scriptSemantics,
      slideOutline,
      slidePlan,
      stage: 'coherence-review',
      target: createDeckPlanningTarget(options, {includeTemplateManifest: true}),
    }),
    role: 'user',
  }

  return createDeckObjectPromptRequest({
    buildMessages: () => [baseMessage],
    id: 'deck.coherence-review',
    promptInput: {analysis, brief, inputPath, options, previousIssues, scriptSemantics, slideOutline, slidePlan},
    schema: LLMTextDeckCoherenceReviewSchema,
    schemaName: 'LLMTextDeckCoherenceReview',
    stage: 'coherence-review',
    temperature: 0.1,
  })
}

async function rewriteInvalidStagedDeckPlan(
  llm: LLMClient,
  input: {
    agent?: ProjectAgentRuntime
    error: unknown
    inputPath: string
    options: TextDeckProjectPlanOptions
    sourceMap: ReturnType<typeof createDeckSourceMap>
    stagedPlan: StagedDeckPlan
    text: string
  },
): Promise<TextDeckProjectPlan> {
  return attemptStagedDeckPlanRewrite(llm, input, {
    attempt: 1,
    issueHistory: [],
    lastError: input.error,
    stagedPlan: input.stagedPlan,
  })
}

async function attemptStagedDeckPlanRewrite(
  llm: LLMClient,
  input: {
    agent?: ProjectAgentRuntime
    inputPath: string
    options: TextDeckProjectPlanOptions
    sourceMap: ReturnType<typeof createDeckSourceMap>
    text: string
  },
  state: {
    attempt: number
    issueHistory: DeckPlanningValidationIssue[][]
    lastError: unknown
    stagedPlan: StagedDeckPlan
  },
): Promise<TextDeckProjectPlan> {
  if (state.attempt > DECK_LLM_VALIDATION_REWRITE_ATTEMPTS) {
    throw new Error(`Deck LLM staged rewrite failed after ${DECK_LLM_VALIDATION_REWRITE_ATTEMPTS} validation feedback attempt(s): ${formatErrorMessage(state.lastError)}`, {
      cause: state.lastError,
    })
  }

  const issues = createDeckPlanningRepairIssues(createDeckPlanningValidationIssues(state.lastError), state.issueHistory)
  const issueHistory = [...state.issueHistory, issues]
  const rewriteStage = chooseRewriteStage(issues)
  const attemptsRemaining = DECK_LLM_VALIDATION_REWRITE_ATTEMPTS - state.attempt
  let stagedPlan: StagedDeckPlan

  if (rewriteStage === 'slide-outline') {
    const slideOutline = await runDeckAgentStep(input.agent, 'outline', `rewrite-slide-outline-${state.attempt}`, 'Rewriting slide outline from validation feedback', () => generateSlideOutline(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, input.options, {
      attemptsRemaining,
      invalidOutput: state.stagedPlan.slideOutline,
      issues,
    }))
    const slidePlan = await runDeckAgentStep(input.agent, 'plan-slides', `rewrite-slide-plan-${state.attempt}`, 'Rebuilding slide plan after outline rewrite', () => generateSlidePlan(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, slideOutline, input.options))

    stagedPlan = {
      ...state.stagedPlan,
      slideOutline,
      slidePlan,
    }

    try {
      validateLLMTextDeckSlidePlanStructure(slidePlan, slideOutline)
      validateLLMTextDeckSlidePlanTemplateConstraints(slidePlan)
    } catch (error) {
      return attemptStagedDeckPlanRewrite(llm, input, {
        attempt: state.attempt + 1,
        issueHistory,
        lastError: error,
        stagedPlan,
      })
    }

    const scriptSemantics = await runDeckAgentStep(input.agent, 'script', `rewrite-script-semantics-${state.attempt}`, 'Rebuilding script semantics after outline rewrite', () => generateScriptSemantics(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, slideOutline, slidePlan, input.options))

    stagedPlan = {
      analysis: state.stagedPlan.analysis,
      brief: state.stagedPlan.brief,
      coherenceReview: state.stagedPlan.coherenceReview,
      options: input.options,
      scriptSemantics,
      slideOutline,
      slidePlan,
    }

    try {
      validateLLMTextDeckScriptSemanticsStructure(scriptSemantics, slideOutline)
    } catch (error) {
      return attemptStagedDeckPlanRewrite(llm, input, {
        attempt: state.attempt + 1,
        issueHistory,
        lastError: error,
        stagedPlan,
      })
    }

    const coherenceReview = await runDeckAgentStep(input.agent, 'script', `rewrite-coherence-review-${state.attempt}`, 'Reviewing rewritten deck plan', () => generateCoherenceReview(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, slideOutline, slidePlan, scriptSemantics, input.options, state.stagedPlan.coherenceReview.issues))

    stagedPlan = {
      analysis: state.stagedPlan.analysis,
      brief: state.stagedPlan.brief,
      coherenceReview,
      options: input.options,
      scriptSemantics,
      slideOutline,
      slidePlan,
    }
  } else if (rewriteStage === 'slide-plan') {
    const slidePlan = await runDeckAgentStep(input.agent, 'plan-slides', `rewrite-slide-plan-${state.attempt}`, 'Rewriting slide plan from validation feedback', () => generateSlidePlan(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, input.options, {
      attemptsRemaining,
      invalidOutput: state.stagedPlan.slidePlan,
      issues,
    }))

    stagedPlan = {
      ...state.stagedPlan,
      slidePlan,
    }

    try {
      validateLLMTextDeckSlidePlanStructure(slidePlan, state.stagedPlan.slideOutline)
      validateLLMTextDeckSlidePlanTemplateConstraints(slidePlan)
    } catch (error) {
      return attemptStagedDeckPlanRewrite(llm, input, {
        attempt: state.attempt + 1,
        issueHistory,
        lastError: error,
        stagedPlan,
      })
    }

    const scriptSemantics = await runDeckAgentStep(input.agent, 'script', `rewrite-script-semantics-${state.attempt}`, 'Rebuilding script semantics after slide plan rewrite', () => generateScriptSemantics(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, slidePlan, input.options))

    stagedPlan = {
      analysis: state.stagedPlan.analysis,
      brief: state.stagedPlan.brief,
      coherenceReview: state.stagedPlan.coherenceReview,
      options: input.options,
      scriptSemantics,
      slideOutline: state.stagedPlan.slideOutline,
      slidePlan,
    }

    try {
      validateLLMTextDeckScriptSemanticsStructure(scriptSemantics, state.stagedPlan.slideOutline)
    } catch (error) {
      return attemptStagedDeckPlanRewrite(llm, input, {
        attempt: state.attempt + 1,
        issueHistory,
        lastError: error,
        stagedPlan,
      })
    }

    const coherenceReview = await runDeckAgentStep(input.agent, 'script', `rewrite-coherence-review-${state.attempt}`, 'Reviewing rewritten deck plan', () => generateCoherenceReview(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, slidePlan, scriptSemantics, input.options, state.stagedPlan.coherenceReview.issues))

    stagedPlan = {
      analysis: state.stagedPlan.analysis,
      brief: state.stagedPlan.brief,
      coherenceReview,
      options: input.options,
      scriptSemantics,
      slideOutline: state.stagedPlan.slideOutline,
      slidePlan,
    }
  } else {
    const scriptSemantics = await runDeckAgentStep(input.agent, 'script', `rewrite-script-semantics-${state.attempt}`, 'Rewriting script semantics from validation feedback', () => generateScriptSemantics(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, state.stagedPlan.slidePlan, input.options, {
      attemptsRemaining,
      invalidOutput: state.stagedPlan.scriptSemantics,
      issues,
    }))

    stagedPlan = {
      analysis: state.stagedPlan.analysis,
      brief: state.stagedPlan.brief,
      coherenceReview: state.stagedPlan.coherenceReview,
      options: input.options,
      scriptSemantics,
      slideOutline: state.stagedPlan.slideOutline,
      slidePlan: state.stagedPlan.slidePlan,
    }

    try {
      validateLLMTextDeckScriptSemanticsStructure(scriptSemantics, state.stagedPlan.slideOutline)
    } catch (error) {
      return attemptStagedDeckPlanRewrite(llm, input, {
        attempt: state.attempt + 1,
        issueHistory,
        lastError: error,
        stagedPlan,
      })
    }

    const coherenceReview = await runDeckAgentStep(input.agent, 'script', `rewrite-coherence-review-${state.attempt}`, 'Reviewing rewritten script semantics', () => generateCoherenceReview(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, state.stagedPlan.slidePlan, scriptSemantics, input.options, state.stagedPlan.coherenceReview.issues))

    stagedPlan = {
      analysis: state.stagedPlan.analysis,
      brief: state.stagedPlan.brief,
      coherenceReview,
      options: input.options,
      scriptSemantics,
      slideOutline: state.stagedPlan.slideOutline,
      slidePlan: state.stagedPlan.slidePlan,
    }
  }

  try {
    validateLLMTextDeckSlideCount(stagedPlan.slideOutline, input.options)
    validateLLMTextDeckSlidePlanStructure(stagedPlan.slidePlan, stagedPlan.slideOutline)
    validateLLMTextDeckScriptSemanticsStructure(stagedPlan.scriptSemantics, stagedPlan.slideOutline)
    assertCoherenceReview(stagedPlan.coherenceReview)
    validateLLMTextDeckScriptSemanticsTiming(stagedPlan.scriptSemantics, stagedPlan.slideOutline, input.options)
    const finalPlan = assembleFinalDeckPlan(stagedPlan.analysis, stagedPlan.slidePlan, stagedPlan.scriptSemantics)

    await input.agent?.completeStage('outline', 'Slide outline complete')
    await input.agent?.completeStage('plan-slides', 'Slide plan complete')
    await input.agent?.completeStage('script', 'Script semantics and coherence review complete')

    return createTextDeckProjectPlanFromLLM(input.inputPath, input.text, finalPlan, {
      ...input.options,
      contentAnalysis: createDeckContentAnalysisArtifact(stagedPlan.analysis),
      deckBrief: createDeckBriefArtifact(stagedPlan.brief),
      coherenceReport: createDeckCoherenceReport(stagedPlan.coherenceReview, stagedPlan.slidePlan),
      slideOutline: createDeckSlideOutlineArtifact(stagedPlan.slideOutline),
      sourceMap: input.sourceMap,
    })
  } catch (error) {
    return attemptStagedDeckPlanRewrite(llm, input, {
      attempt: state.attempt + 1,
      issueHistory,
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
        outlineId: slide.outlineId,
        points: slide.points,
        ...(slide.process === undefined ? {} : {process: slide.process}),
        ...(slide.quote === undefined ? {} : {quote: slide.quote}),
        semantic: scriptSlide.semantic,
        sectionIds: slide.sectionIds,
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

function createDeckContentAnalysisArtifact(analysis: LLMTextDeckContentAnalysis) {
  return DeckContentAnalysisSchema.parse({
    ...analysis,
    generatedAt: new Date().toISOString(),
    source: 'source-map.json',
    version: 1,
  })
}

function createDeckBriefArtifact(brief: LLMTextDeckBrief) {
  return DeckBriefSchema.parse({
    ...brief,
    generatedAt: new Date().toISOString(),
    source: 'content-analysis.json',
    version: 1,
  })
}

function createDeckCoherenceReport(review: LLMTextDeckCoherenceReview, slidePlan: LLMTextDeckSlidePlan) {
  const issues = review.issues.map((issue) => {
    const slide = issue.slideIndex === undefined ? undefined : slidePlan.slides[issue.slideIndex]
    const severity = normalizedCoherenceIssueSeverity(issue)

    return {
      code: issue.code,
      message: issue.message,
      ...(issue.path === undefined ? {} : {path: issue.path}),
      severity,
      ...(slide === undefined ? {} : {slideId: slide.outlineId}),
      stage: issue.stage,
    }
  })

  return DeckCoherenceReportSchema.parse({
    checkedAt: new Date().toISOString(),
    issues,
    reviewer: 'llm',
    summary: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
    },
    version: 1,
  })
}

function assertCoherenceReview(review: LLMTextDeckCoherenceReview): void {
  const errors = review.issues.filter((issue) => normalizedCoherenceIssueSeverity(issue) === 'error')

  if (errors.length === 0) {
    return
  }

  throw new DeckCoherenceReviewValidationError(errors.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ...(issue.path === undefined ? {} : {path: issue.path}),
    ...(issue.slideIndex === undefined ? {} : {slideIndex: issue.slideIndex}),
    stage: issue.stage,
  })))
}

function normalizedCoherenceIssueSeverity(issue: LLMTextDeckCoherenceReview['issues'][number]): 'error' | 'warning' {
  if (isGlobalDurationBudgetIssue(issue)) {
    return 'warning'
  }

  return issue.severity
}

function isGlobalDurationBudgetIssue(issue: LLMTextDeckCoherenceReview['issues'][number]): boolean {
  if (issue.code !== 'TIMING_BUDGET_MISMATCH' || issue.slideIndex !== undefined) {
    return false
  }

  const text = `${issue.path ?? ''} ${issue.message}`

  return (
    /target(duration|\.durationSeconds)|target\s+duration|目标(总)?时长|brief\.targetDurationSeconds/iu.test(text)
    && /(total|overall|总|合计|预算).*(budget|duration|时长|叙事)|budget.*target|预算.*目标/iu.test(text)
  )
}

function createDeckSlideOutlineArtifact(slideOutline: LLMTextDeckSlideOutline) {
  return DeckSlideOutlineSchema.parse({
    ...slideOutline,
    generatedAt: new Date().toISOString(),
    source: 'deck-brief.json',
    version: 1,
  })
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

function countWords(text: string): number {
  const words = text.trim().match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/gu)

  return words?.length ?? 0
}

function countCjkAwareCharacters(text: string): number {
  return [...text.replace(/\s+/gu, '')].length
}

function isCjkLanguage(language: string): boolean {
  return /^(zh|ja|ko)\b/iu.test(language)
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/u.test(text)
}

function createDeckPlanningIntent(options: TextDeckProjectPlanOptions): DeckPlanningIntent {
  return {
    contentDensity: createDeckContentDensityTarget(options),
    format: options.deckFormat ?? 'portrait_1080x1920',
    language: options.language,
    maxVisibleCharactersPerSlide: options.maxSlideCharacters,
    ...(options.durationTargetSeconds === undefined ? {} : {durationSeconds: options.durationTargetSeconds}),
    ...(options.theme === undefined || options.theme === 'auto' ? {} : {requestedTheme: options.theme}),
    ...(options.title === undefined ? {} : {requestedTitle: options.title}),
    ...(options.requiredSlideTypes === undefined ? {} : {requiredSlideTypes: options.requiredSlideTypes}),
    slideCount: createDeckSlideCountIntent(options),
  }
}

function createDeckContentDensityTarget(options: TextDeckProjectPlanOptions): DeckContentDensityTarget {
  const level = options.contentDensity ?? 'balanced'

  if (level === 'concise') {
    return {
      level,
      narrationPolicy: 'Use short presenter notes that explain only the visible point and the minimum transition context required for comprehension.',
      slideCountPolicy: 'Prefer fewer slides when source coverage remains faithful. Combine closely related details instead of expanding every example.',
      visibleTextPolicy: 'Use compact titles and one to two short visible points when possible. Omit secondary examples unless they are required for source fidelity.',
    }
  }

  if (level === 'detailed') {
    return {
      level,
      narrationPolicy: 'Use the available narration budget to explain concrete steps, caveats, examples, evidence, and why each visible point matters. Do not add unsupported material.',
      slideCountPolicy: 'Prefer splitting dense source material into more coherent slides instead of over-compressing required steps, examples, caveats, or evidence.',
      visibleTextPolicy: 'Include enough visible detail for the slide to be useful without narration: concrete nouns, key steps, caveats, and evidence labels, while staying within template limits.',
    }
  }

  return {
    level,
    narrationPolicy: 'Use natural presenter notes with enough context to connect the slide points, without expanding beyond the slide goal or narration budget.',
    slideCountPolicy: 'Balance slide count against source coverage. Split unrelated or dense required material, but keep closely related ideas together.',
    visibleTextPolicy: 'Use clear PPT-style visible text with two to three useful points when the template supports them, while preserving white space and source fidelity.',
  }
}

function createDeckSlideCountIntent(options: TextDeckProjectPlanOptions): DeckSlideCountIntent {
  const minimum = Math.max(1, options.requiredSlideTypes?.length ?? 1)
  const maximum = options.slideCountMax ?? LLM_TEXT_DECK_MAX_SLIDES
  const target = options.slideCountTarget

  if (!Number.isInteger(maximum) || maximum < minimum || maximum > LLM_TEXT_DECK_MAX_SLIDES) {
    throw new Error(`Deck max slide count must be an integer between ${minimum} and ${LLM_TEXT_DECK_MAX_SLIDES}; received ${maximum}.`)
  }

  if (target !== undefined && (!Number.isInteger(target) || target < minimum || target > maximum)) {
    throw new Error(`Deck target slide count must be an integer between ${minimum} and ${maximum}; received ${target}.`)
  }

  return {
    maximum,
    minimum,
    policy: target === undefined
      ? 'Choose slide count from source complexity, required coverage, content density, duration, and template capacity within this range.'
      : 'Use the exact target slide count. Preserve source coverage by choosing tighter slide goals before violating the target.',
    ...(target === undefined ? {} : {target}),
  }
}

function createDeckPlanningTarget(options: TextDeckProjectPlanOptions, settings: {includeTemplateManifest: boolean}): object {
  const intent = createDeckPlanningIntent(options)

  return {
    availableThemes: Object.entries(DECK_THEME_DESCRIPTIONS).map(([name, description]) => ({description, name})),
    contentDensity: intent.contentDensity,
    durationSeconds: intent.durationSeconds,
    format: intent.format,
    language: intent.language,
    maxVisibleCharactersPerSlide: intent.maxVisibleCharactersPerSlide,
    requestedTheme: intent.requestedTheme,
    requestedTitle: intent.requestedTitle,
    requiresOutline: true,
    requiresSlideTransitions: true,
    requiresSlideSourceRanges: true,
    requiredSlideTypes: intent.requiredSlideTypes,
    slideCount: intent.slideCount,
    speakerNotePlanning: {
      budgetSource: 'slideOutline.slides[].narrationBudgetSeconds as pacing guidance',
      englishWordsPerSecond: 2.6,
      policy: 'Plan narration against the whole deck duration. Use slide-level budgets as pacing guidance, not hard caps; rebalance detail and duration across slides.',
      zhCharactersPerSecond: 4.8,
    },
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
  if (error instanceof LLMTextDeckValidationError) {
    return error.issues
  }

  if (error instanceof DeckCoherenceReviewValidationError) {
    return error.issues
  }

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

function createDeckPlanningRepairIssues(
  issues: DeckPlanningValidationIssue[],
  issueHistory: DeckPlanningValidationIssue[][],
): DeckPlanningValidationIssue[] {
  return issues.map((issue) => {
    const repeatCount = countPreviousMatchingIssues(issue, issueHistory) + 1
    const repair = createDeckPlanningRepairContract(issue)
    const shouldEscalateToSlidePlan = issue.stage === 'script-semantics' && repeatCount >= 2 && shouldEscalateRepeatedScriptIssue(issue)

    return {
      ...issue,
      ...repair,
      repeatCount,
      ...(shouldEscalateToSlidePlan
        ? {
            escalationReason: `This ${issue.code} issue for the same slide/path has survived ${repeatCount} rewrite attempt(s); update visible slide structure before rebuilding script semantics.`,
            stage: 'slide-plan' as const,
          }
        : {}),
    }
  })
}

function shouldEscalateRepeatedScriptIssue(issue: DeckPlanningValidationIssue): boolean {
  return issue.code === 'LOW_INFORMATION_DEPTH' || issue.code === 'MISSING_PRACTICAL_DETAIL' || issue.code === 'COHERENCE_GAP'
}

function countPreviousMatchingIssues(issue: DeckPlanningValidationIssue, issueHistory: DeckPlanningValidationIssue[][]): number {
  const signature = createDeckPlanningIssueSignature(issue)

  return issueHistory.flat().filter((previous) => createDeckPlanningIssueSignature(previous) === signature).length
}

function createDeckPlanningIssueSignature(issue: DeckPlanningValidationIssue): string {
  return [
    issue.code,
    issue.slideIndex ?? 'global',
    issue.path ?? 'no-path',
  ].join('|')
}

function createDeckPlanningRepairContract(issue: DeckPlanningValidationIssue): Pick<DeckPlanningValidationIssue, 'forbiddenFixes' | 'repairStrategy' | 'requiredAdditions'> {
  if (issue.code === 'LOW_INFORMATION_DEPTH') {
    return {
      forbiddenFixes: [
        'Do not only restate the existing headline, formula, or visible points.',
        'Do not add generic adjectives such as clear, actionable, important, or practical without criteria.',
      ],
      repairStrategy: 'requireOperationalCriteria',
      requiredAdditions: [
        'Name the missing concrete method or decision criteria described by the issue.',
        'Add at least one source-grounded way to estimate, verify, or apply the concept.',
        'Add one compact example or judgment sentence that shows how the viewer would use the concept.',
      ],
    }
  }

  if (issue.code === 'MISSING_PRACTICAL_DETAIL') {
    return {
      forbiddenFixes: [
        'Do not replace missing detail with a broad summary.',
        'Do not leave placeholders such as X/Y/company without explaining how to fill them.',
      ],
      repairStrategy: 'requirePracticalDetail',
      requiredAdditions: [
        'Add concrete thresholds, observable inputs, examples, or decision branches requested by the issue.',
        'If the issue asks for scoring, scale, or score-band detail, include the visible score scale meaning, named scoring criteria, and how score results change priority or action.',
        'Explain what the viewer should check and how the result changes the recommendation or next step.',
      ],
    }
  }

  if (issue.code === 'COHERENCE_GAP') {
    return {
      forbiddenFixes: [
        'Do not add a transition phrase unless it explains the causal link.',
      ],
      repairStrategy: 'requireTransitionLogic',
      requiredAdditions: [
        'Explain the missing causal or procedural bridge between the affected slides.',
        'State how the previous slide output becomes the next slide input.',
      ],
    }
  }

  if (issue.code === 'TEMPLATE_REPETITION') {
    return {
      forbiddenFixes: [
        'Do not keep the same repeated template when a more structured registered template fits the source.',
      ],
      repairStrategy: 'requireTemplateReplan',
      requiredAdditions: [
        'Choose a registered template that exposes the source structure more clearly.',
        'Preserve the source meaning while changing only the needed slide structure and visible text.',
      ],
    }
  }

  if (issue.code === 'TIMING_BUDGET_MISMATCH' || issue.code === 'SCRIPT_TIMING' || issue.code === 'SCRIPT_TIMING_TOTAL_BUDGET' || issue.code === 'SCRIPT_DURATION_TOTAL') {
    return {
      repairStrategy: 'rebalanceTimingOrNarration',
      requiredAdditions: [
        'Make aggregate narration length, semantic durations, and target duration consistent without relying on runtime scaling.',
      ],
    }
  }

  return {
    repairStrategy: 'satisfyValidation',
    requiredAdditions: [
      'Satisfy the validation issue exactly at the reported field/path.',
    ],
  }
}

function chooseRewriteStage(issues: DeckPlanningValidationIssue[]): 'script-semantics' | 'slide-outline' | 'slide-plan' {
  if (issues.some((issue) => issue.stage === 'slide-outline')) {
    return 'slide-outline'
  }

  return issues.some((issue) => issue.stage === 'slide-plan') ? 'slide-plan' : 'script-semantics'
}

function classifyValidationStage(message: string): DeckPlanningValidationIssue['stage'] {
  const coherenceStage = parseCoherenceRewriteStage(message)

  if (coherenceStage !== undefined) {
    return coherenceStage
  }

  if (
    message.includes('slide outline')
    || message.includes('slide count')
    || message.includes('required source section')
    || message.includes('requiredSectionIds')
    || message.includes('mustCover')
    || message.includes('sourceSectionIds')
  ) {
    return 'slide-outline'
  }

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
    || message.includes('script-semantics')
    || message.includes('outline')
    || message.includes('claim')
    || message.includes('moment')
  ) {
    return 'script-semantics'
  }

  return 'final-build'
}

function classifyIssueCode(message: string): string {
  if (message.includes('Deck coherence review requires')) {
    return parseCoherenceIssueCode(message) ?? 'COHERENCE_REVIEW'
  }

  if (
    message.includes('slide count')
    || message.includes('Deck slide outline has')
  ) {
    return 'SLIDE_COUNT'
  }

  if (
    message.includes('required source section')
    || message.includes('requiredSectionIds')
    || message.includes('mustCover')
    || message.includes('sourceSectionIds')
  ) {
    return 'SOURCE_COVERAGE'
  }

  if (message.includes('speakerNote timing preflight') || message.includes('estimated total speakerNote') || message.includes('estimated total narration')) {
    return 'SCRIPT_TIMING'
  }

  if (message.includes('script-semantics')) {
    return 'SCRIPT_SEMANTICS_CARDINALITY'
  }

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
  if (message.includes('Deck coherence review requires')) {
    return parseCoherenceIssuePath(message) ?? 'deck-coherence-report.json'
  }

  if (
    message.includes('slide count')
    || message.includes('Deck slide outline has')
  ) {
    return 'slideOutline.slides'
  }

  if (
    message.includes('required source section')
    || message.includes('requiredSectionIds')
    || message.includes('mustCover')
    || message.includes('sourceSectionIds')
  ) {
    return 'slideOutline.slides[].sourceSectionIds'
  }

  if (message.includes('speakerNote timing preflight') || message.includes('estimated total speakerNote') || message.includes('estimated total narration')) {
    return 'scriptSemantics.slides[].speakerNote'
  }

  if (message.includes('script-semantics')) {
    return 'scriptSemantics.slides'
  }

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

function parseCoherenceRewriteStage(message: string): 'script-semantics' | 'slide-outline' | 'slide-plan' | undefined {
  const match = /Deck coherence review requires (slide-outline|slide-plan|script-semantics) rewrite/u.exec(message)

  if (match?.[1] === 'slide-outline' || match?.[1] === 'slide-plan' || match?.[1] === 'script-semantics') {
    return match[1]
  }

  return undefined
}

function parseCoherenceIssueCode(message: string): string | undefined {
  const match = /rewrite:\s+([A-Z_]+):/u.exec(message)

  return match?.[1]
}

function parseCoherenceIssuePath(message: string): string | undefined {
  const match = /\sPath:\s+(.+)$/u.exec(message)

  return match?.[1]
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
