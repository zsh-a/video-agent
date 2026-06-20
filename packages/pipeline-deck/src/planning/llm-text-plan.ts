import type {GenerateObjectRequest, LLMClient, LLMMessage} from '@video-agent/llm'

import {createHash} from 'node:crypto'

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
import {DECK_THEME_DESCRIPTIONS} from './utils.js'
import {createTextDeckProjectPlanFromLLM} from './text-plan-builder.js'
import {createDeckSourceMap} from './source-map.js'

const DECK_LLM_SOURCE_TEXT_CHUNK_CHARACTERS = 60_000
const DECK_LLM_TRANSCRIPT_SEGMENT_CHUNK_SIZE = 500
const DECK_LLM_TRANSCRIPT_SEGMENT_TEXT_MAX_CHARACTERS = 500
const DECK_LLM_VALIDATION_REWRITE_ATTEMPTS = 5
const DECK_LLM_CACHE_KEY_HASH_CHARACTERS = 24

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
  scriptSemantics: LLMTextDeckScriptSemantics
  slideOutline: LLMTextDeckSlideOutline
  slidePlan: LLMTextDeckSlidePlan
}

type DeckPlanningValidationIssue = Omit<LLMTextDeckValidationIssue, 'stage'> & {
  stage: DeckLLMPlanningStage | 'final-build'
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

export async function createLLMTextDeckProjectPlan(
  llm: LLMClient,
  inputPath: string,
  text: string,
  options: TextDeckProjectPlanOptions,
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
  const stagedPlan = await createStagedDeckPlan(llm, inputPath, text, sourceMap, planOptions)

  try {
    assertCoherenceReview(stagedPlan.coherenceReview)
    const finalPlan = assembleFinalDeckPlan(stagedPlan.analysis, stagedPlan.slidePlan, stagedPlan.scriptSemantics)

    return createTextDeckProjectPlanFromLLM(inputPath, text, finalPlan, {
      ...planOptions,
      contentAnalysis: createDeckContentAnalysisArtifact(stagedPlan.analysis),
      deckBrief: createDeckBriefArtifact(stagedPlan.brief),
      coherenceReport: createDeckCoherenceReport(stagedPlan.coherenceReview, stagedPlan.slidePlan),
      slideOutline: createDeckSlideOutlineArtifact(stagedPlan.slideOutline),
      sourceMap,
    })
  } catch (error) {
    return rewriteInvalidStagedDeckPlan(llm, {
      error,
      inputPath,
      options: planOptions,
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
): Promise<StagedDeckPlan> {
  const analysis = await createContentAnalysis(llm, inputPath, text, sourceMap, options)
  const brief = await generateDeckBrief(llm, inputPath, analysis, options)
  const slideOutline = await generateSlideOutline(llm, inputPath, analysis, brief, options)
  const slidePlan = await generateSlidePlan(llm, inputPath, analysis, brief, slideOutline, options)
  const scriptSemantics = await generateScriptSemantics(llm, inputPath, analysis, brief, slideOutline, slidePlan, options)
  const coherenceReview = await generateCoherenceReview(llm, inputPath, analysis, brief, slideOutline, slidePlan, scriptSemantics, options)

  return {
    analysis,
    brief,
    coherenceReview,
    scriptSemantics,
    slideOutline,
    slidePlan,
  }
}

async function createContentAnalysis(
  llm: LLMClient,
  inputPath: string,
  text: string,
  sourceMap: ReturnType<typeof createDeckSourceMap>,
  options: TextDeckProjectPlanOptions,
): Promise<LLMTextDeckContentAnalysis> {
  const chunks = createDeckPlanningSourceChunks(text, options)
  const analyses = await Promise.all(chunks.map(async (chunk) => {
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

  const result = await llm.generateObject(createContentAnalysisMergeRequest(inputPath, analyses, options))

  return result.object
}

function createContentAnalysisRequest(
  inputPath: string,
  chunk: DeckPlanningSourceChunk,
  sourceMap: ReturnType<typeof createDeckSourceMap>,
  options: TextDeckProjectPlanOptions,
): GenerateObjectRequest<LLMTextDeckContentAnalysis> {
  const baseMessage = createContentAnalysisMessage(inputPath, chunk, sourceMap, options)

  return {
    cache: createDeckLLMCacheHint('content-analysis', baseMessage),
    messages: [baseMessage],
    schema: LLMTextDeckContentAnalysisSchema,
    temperature: 0.2,
  }
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
  const baseMessage: LLMMessage = {
    content: JSON.stringify({
      analysis,
      goal: 'Create a presentation brief for a Deck explainer. Decide coverage strategy, target slide count, narrative arc, density policy, and required source sections. Do not write slide text or narration.',
      instructions: [
        'Base requiredSectionIds on analysis.sections where mustCover is true. Preserve section ids exactly.',
        'Choose targetSlideCount from source complexity and required sections. It must be large enough that must-cover sections are not compressed into unrelated slides.',
        'Use targetDurationSeconds from target.durationSeconds when provided; otherwise choose a realistic duration from source complexity.',
        'Describe a narrativeArc that can guide slide ordering without writing slide titles.',
        'Write densityPolicy as concrete generation guidance for slide and narration density.',
      ],
      inputPath,
      stage: 'deck-brief',
      target: createDeckPlanningTarget(options, {includeTemplateManifest: false}),
    }),
    role: 'user',
  }

  return {
    cache: createDeckLLMCacheHint('deck-brief', baseMessage),
    messages: [baseMessage],
    schema: LLMTextDeckBriefSchema,
    temperature: 0.2,
  }
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
        'Use one outline slide for one coherent idea. Split unrelated required sections instead of combining them.',
        'Set narrationBudgetSeconds based on target duration and slide goal; use realistic TTS budgets rather than optimistic visual durations.',
        'templateIntent must be one registered template type and should match the information role and source content.',
        'visualIntent should describe the visual job of the slide without CSS, fonts, or coordinates.',
      ],
      inputPath,
      stage: 'slide-outline',
      target: createDeckPlanningTarget(options, {includeTemplateManifest: true}),
    }),
    role: 'user',
  }

  if (rewrite === undefined) {
    return {
      cache: createDeckLLMCacheHint('slide-outline', baseMessage),
      messages: [baseMessage],
      schema: LLMTextDeckSlideOutlineSchema,
      temperature: 0.2,
    }
  }

  return {
    cache: createDeckLLMCacheHint('slide-outline', baseMessage),
    messages: [
      baseMessage,
      {
        content: JSON.stringify({
          invalidOutput: rewrite.invalidOutput,
          issues: rewrite.issues,
          stage: 'slide-outline',
        }),
        role: 'assistant',
      },
      {
        content: JSON.stringify({
          attemptsRemaining: rewrite.attemptsRemaining,
          goal: 'Rewrite the slide-outline stage output so it satisfies the structured validation issues. Return a complete replacement slide-outline object, not a patch.',
          instructions: [
            'Use issues as binding coverage and outline feedback.',
            'Every brief.requiredSectionIds entry and every mustCover analysis section must appear in at least one slides[].sourceSectionIds array.',
            'If a slide covers too many unrelated source sections, split it into multiple coherent outline slides instead of compressing them.',
            'Preserve source section ids exactly; do not invent ids that are absent from analysis.sections or brief required/optional ids.',
            'Keep narrationBudgetSeconds realistic for the slide goal and target duration; do not inflate budgets to hide overlong narration.',
            'Do not write visible slide text, speaker notes, transitions, motion, or semantic metadata in this stage.',
          ],
          issues: rewrite.issues,
        }),
        role: 'user',
      },
    ],
    schema: LLMTextDeckSlideOutlineSchema,
    temperature: 0.2,
  }
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

  return {
    cache: createDeckLLMCacheHint('content-analysis-merge', baseMessage),
    messages: [baseMessage],
    schema: LLMTextDeckContentAnalysisSchema,
    temperature: 0.2,
  }
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
      goal: 'Turn the approved slide outline into concise PPT-style slide data. Return slide structure, visible text, template data, visuals, motion, and transitions only.',
      instructions: [
        'Return exactly one slide-plan slide for each slideOutline.slides item, preserving outlineId and sourceSectionIds as sectionIds.',
        'Use slideOutline.templateIntent as the default slide type unless the template manifest makes a different controlled template clearly better.',
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
      slideOutline,
      stage: 'slide-plan',
      target: createDeckPlanningTarget(options, {includeTemplateManifest: true}),
    }),
    role: 'user',
  }

  if (rewrite === undefined) {
    return {
      cache: createDeckLLMCacheHint('slide-plan', baseMessage),
      messages: [baseMessage],
      schema: LLMTextDeckSlidePlanSchema,
      temperature: 0.2,
    }
  }

  return {
    cache: createDeckLLMCacheHint('slide-plan', baseMessage),
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
            'Resolve every issue in the issues array before returning; do not stop after fixing only the first issue.',
            'Before returning, count every generated title, subtitle, point, comparison point, and chart label with JavaScript string length semantics and ensure each value is within its listed issue.limit and the target.templateManifest limit.',
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
        'Use slideOutline.slides[].narrationBudgetSeconds as a hard budget. Keep estimated speech duration within that budget unless the source section must be split; in that case the correct fix is to shorten narration and flag through validation, not to inflate duration.',
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

  if (rewrite === undefined) {
    return {
      cache: createDeckLLMCacheHint('script-semantics', baseMessage),
      messages: [baseMessage],
      schema: LLMTextDeckScriptSemanticsSchema,
      temperature: 0.2,
    }
  }

  return {
    cache: createDeckLLMCacheHint('script-semantics', baseMessage),
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
            'Resolve every issue in the issues array before returning; do not stop after fixing only the first issue.',
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

async function generateCoherenceReview(
  llm: LLMClient,
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  brief: LLMTextDeckBrief,
  slideOutline: LLMTextDeckSlideOutline,
  slidePlan: LLMTextDeckSlidePlan,
  scriptSemantics: LLMTextDeckScriptSemantics,
  options: TextDeckProjectPlanOptions,
): Promise<LLMTextDeckCoherenceReview> {
  const result = await llm.generateObject(createCoherenceReviewRequest(inputPath, analysis, brief, slideOutline, slidePlan, scriptSemantics, options))

  return result.object
}

function createCoherenceReviewRequest(
  inputPath: string,
  analysis: LLMTextDeckContentAnalysis,
  brief: LLMTextDeckBrief,
  slideOutline: LLMTextDeckSlideOutline,
  slidePlan: LLMTextDeckSlidePlan,
  scriptSemantics: LLMTextDeckScriptSemantics,
  options: TextDeckProjectPlanOptions,
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
        'Check timing realism: narrationBudgetSeconds and scriptSemantics.slides[].duration should match the actual speakerNote length. Overly long budgets for short notes should be warnings; severe budget mismatch that makes the final video much shorter than target should be an error for script-semantics or slide-outline.',
        'Check template variety: do not use repeated one-big-idea/summary cards when process, table, code, comparison, stat, quote, or chart would make the source structure clearer.',
        'For each issue choose the earliest responsible stage: slide-outline for coverage/order/budget/template intent, slide-plan for visible text/template choice, script-semantics for narration/duration/semantic metadata.',
        'Use severity error only when rewrite is required before artifact build; use warning for reviewable quality concerns.',
      ],
      inputPath,
      scriptSemantics,
      slideOutline,
      slidePlan,
      stage: 'coherence-review',
      target: createDeckPlanningTarget(options, {includeTemplateManifest: true}),
    }),
    role: 'user',
  }

  return {
    cache: createDeckLLMCacheHint('coherence-review', baseMessage),
    messages: [baseMessage],
    schema: LLMTextDeckCoherenceReviewSchema,
    temperature: 0.1,
  }
}

async function rewriteInvalidStagedDeckPlan(
  llm: LLMClient,
  input: {
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
    lastError: input.error,
    stagedPlan: input.stagedPlan,
  })
}

async function attemptStagedDeckPlanRewrite(
  llm: LLMClient,
  input: {
    inputPath: string
    options: TextDeckProjectPlanOptions
    sourceMap: ReturnType<typeof createDeckSourceMap>
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

  if (rewriteStage === 'slide-outline') {
    const slideOutline = await generateSlideOutline(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, input.options, {
      attemptsRemaining,
      invalidOutput: state.stagedPlan.slideOutline,
      issues,
    })
    const slidePlan = await generateSlidePlan(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, slideOutline, input.options)

    stagedPlan = {
      ...state.stagedPlan,
      slideOutline,
      slidePlan,
    }

    try {
      validateLLMTextDeckSlidePlanTemplateConstraints(slidePlan)
    } catch (error) {
      return attemptStagedDeckPlanRewrite(llm, input, {
        attempt: state.attempt + 1,
        lastError: error,
        stagedPlan,
      })
    }

    const scriptSemantics = await generateScriptSemantics(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, slideOutline, slidePlan, input.options)

    const coherenceReview = await generateCoherenceReview(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, slideOutline, slidePlan, scriptSemantics, input.options)

    stagedPlan = {
      analysis: state.stagedPlan.analysis,
      brief: state.stagedPlan.brief,
      coherenceReview,
      scriptSemantics,
      slideOutline,
      slidePlan,
    }
  } else if (rewriteStage === 'slide-plan') {
    const slidePlan = await generateSlidePlan(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, input.options, {
      attemptsRemaining,
      invalidOutput: state.stagedPlan.slidePlan,
      issues,
    })

    stagedPlan = {
      ...state.stagedPlan,
      slidePlan,
    }

    try {
      validateLLMTextDeckSlidePlanTemplateConstraints(slidePlan)
    } catch (error) {
      return attemptStagedDeckPlanRewrite(llm, input, {
        attempt: state.attempt + 1,
        lastError: error,
        stagedPlan,
      })
    }

    const scriptSemantics = await generateScriptSemantics(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, slidePlan, input.options)

    const coherenceReview = await generateCoherenceReview(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, slidePlan, scriptSemantics, input.options)

    stagedPlan = {
      analysis: state.stagedPlan.analysis,
      brief: state.stagedPlan.brief,
      coherenceReview,
      scriptSemantics,
      slideOutline: state.stagedPlan.slideOutline,
      slidePlan,
    }
  } else {
    const scriptSemantics = await generateScriptSemantics(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, state.stagedPlan.slidePlan, input.options, {
      attemptsRemaining,
      invalidOutput: state.stagedPlan.scriptSemantics,
      issues,
    })

    const coherenceReview = await generateCoherenceReview(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, state.stagedPlan.slidePlan, scriptSemantics, input.options)

    stagedPlan = {
      analysis: state.stagedPlan.analysis,
      brief: state.stagedPlan.brief,
      coherenceReview,
      scriptSemantics,
      slideOutline: state.stagedPlan.slideOutline,
      slidePlan: state.stagedPlan.slidePlan,
    }
  }

  try {
    assertCoherenceReview(stagedPlan.coherenceReview)
    const finalPlan = assembleFinalDeckPlan(stagedPlan.analysis, stagedPlan.slidePlan, stagedPlan.scriptSemantics)

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

    return {
      code: issue.code,
      message: issue.message,
      ...(issue.path === undefined ? {} : {path: issue.path}),
      severity: issue.severity,
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
  const firstError = review.issues.find((issue) => issue.severity === 'error')

  if (firstError === undefined) {
    return
  }

  const issuePath = firstError.path === undefined ? '' : ` Path: ${firstError.path}`

  throw new Error(`Deck coherence review requires ${firstError.stage} rewrite: ${firstError.code}: ${firstError.message}${issuePath}`)
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
    speakerNotePlanning: {
      budgetSource: 'slideOutline.slides[].narrationBudgetSeconds',
      englishWordsPerSecond: 2.6,
      maxSlideSeconds: 12,
      policy: 'Write to the explicit narration budget. Split or shorten before exceeding the budget; do not rely on post-TTS timing expansion.',
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
    message.includes('required source section')
    || message.includes('requiredSectionIds')
    || message.includes('mustCover')
    || message.includes('sourceSectionIds')
  ) {
    return 'SOURCE_COVERAGE'
  }

  if (message.includes('speakerNote timing preflight') || message.includes('underestimated speakerNote')) {
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
    message.includes('required source section')
    || message.includes('requiredSectionIds')
    || message.includes('mustCover')
    || message.includes('sourceSectionIds')
  ) {
    return 'slideOutline.slides[].sourceSectionIds'
  }

  if (message.includes('speakerNote timing preflight') || message.includes('underestimated speakerNote')) {
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
