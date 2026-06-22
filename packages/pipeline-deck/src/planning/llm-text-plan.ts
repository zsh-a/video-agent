import type {LLMClient} from '@video-agent/llm'
import type {ProjectAgentRuntime} from '@video-agent/runtime'

import {DeckBriefSchema, DeckCoherenceReportSchema, DeckContentAnalysisSchema, DeckSlideOutlineSchema} from '@video-agent/ir'
import {CONTENT_ANALYSIS_ARTIFACT_NAME, DECK_BRIEF_ARTIFACT_NAME, SOURCE_MAP_ARTIFACT_NAME} from '@video-agent/runtime'

import {
  LLMTextDeckPlanSchema,
  validateLLMTextDeckSlidePlanTemplateConstraints,
  type LLMTextDeckBrief,
  type LLMTextDeckCoherenceReview,
  type LLMTextDeckContentAnalysis,
  type LLMTextDeckPlan,
  type LLMTextDeckScriptSemantics,
  type LLMTextDeckSlideOutline,
  type LLMTextDeckSlidePlan,
} from './llm-plan.js'
import type {TextDeckProjectPlan, TextDeckProjectPlanOptions} from './types.js'
import {createDeckPlanningSourceChunks, requireDeckPlanningSourceType} from './llm-text-plan-input.js'
import {createCoherenceReviewRequest, createContentAnalysisMergeRequest, createContentAnalysisRequest, createDeckBriefRequest, createScriptSemanticsRequest, createSlideOutlineRequest, createSlidePlanRequest} from './llm-text-plan-requests.js'
import {
  DECK_LLM_COHERENCE_REVIEW_STAGE,
  DECK_LLM_CONTENT_ANALYSIS_MERGE_STAGE,
  DECK_LLM_CONTENT_ANALYSIS_STAGE,
  DECK_LLM_DECK_BRIEF_STAGE,
  DECK_LLM_SCRIPT_SEMANTICS_STAGE,
  DECK_LLM_SLIDE_OUTLINE_STAGE,
  DECK_LLM_SLIDE_PLAN_STAGE,
  type DeckLLMPlanningStage,
} from './llm-text-plan-stages.js'
import {
  assertCoherenceReview,
  chooseRewriteStage,
  createDeckPlanningRepairIssues,
  createDeckPlanningValidationIssues,
  formatErrorMessage,
  normalizeCoherenceReview,
  normalizedCoherenceIssueSeverity,
  validateLLMTextDeckScriptSemanticsStructure,
  validateLLMTextDeckScriptSemanticsTiming,
  validateLLMTextDeckSlideCount,
  validateLLMTextDeckSlidePlanStructure,
  type DeckPlanningValidationIssue,
} from './llm-text-plan-validation.js'
import {createTextDeckProjectPlanFromLLM} from './text-plan-builder.js'
import {createDeckSourceMap} from './source-map.js'
import {DECK_STAGE_IDS} from '../pipeline.js'

const DECK_LLM_VALIDATION_REWRITE_ATTEMPTS = 5

interface StagedDeckPlan {
  analysis: LLMTextDeckContentAnalysis
  brief: LLMTextDeckBrief
  coherenceReview: LLMTextDeckCoherenceReview
  options: TextDeckProjectPlanOptions
  scriptSemantics: LLMTextDeckScriptSemantics
  slideOutline: LLMTextDeckSlideOutline
  slidePlan: LLMTextDeckSlidePlan
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
  const analysis = await runDeckAgentStep(agent, DECK_STAGE_IDS.understand, DECK_LLM_CONTENT_ANALYSIS_STAGE, 'Analyzing source content', () => createContentAnalysis(llm, inputPath, text, sourceMap, options, agent))
  await agent?.completeStage(DECK_STAGE_IDS.understand, 'Source understanding complete')
  const brief = await runDeckAgentStep(agent, DECK_STAGE_IDS.brief, DECK_LLM_DECK_BRIEF_STAGE, 'Writing deck brief', () => generateDeckBrief(llm, inputPath, analysis, options))
  await agent?.completeStage(DECK_STAGE_IDS.brief, 'Deck brief complete')
  const effectiveOptions = createEffectiveDeckPlanningOptions(options, brief)
  const slideOutline = await runDeckAgentStep(agent, DECK_STAGE_IDS.outline, DECK_LLM_SLIDE_OUTLINE_STAGE, 'Planning slide outline', () => generateSlideOutline(llm, inputPath, analysis, brief, effectiveOptions))
  await agent?.completeStage(DECK_STAGE_IDS.outline, 'Slide outline complete')
  const slidePlan = await runDeckAgentStep(agent, DECK_STAGE_IDS.planSlides, DECK_LLM_SLIDE_PLAN_STAGE, 'Designing semantic slide plan', () => generateSlidePlan(llm, inputPath, analysis, brief, slideOutline, effectiveOptions))
  await agent?.completeStage(DECK_STAGE_IDS.planSlides, 'Slide plan complete')
  const scriptSemantics = await runDeckAgentStep(agent, DECK_STAGE_IDS.script, DECK_LLM_SCRIPT_SEMANTICS_STAGE, 'Writing script semantics', () => generateScriptSemantics(llm, inputPath, analysis, brief, slideOutline, slidePlan, effectiveOptions))
  const coherenceReview = await runDeckAgentStep(agent, DECK_STAGE_IDS.script, DECK_LLM_COHERENCE_REVIEW_STAGE, 'Reviewing narrative coherence', () => generateCoherenceReview(llm, inputPath, analysis, brief, slideOutline, slidePlan, scriptSemantics, effectiveOptions))
  await agent?.completeStage(DECK_STAGE_IDS.script, 'Script semantics and coherence review complete')

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
    await agent?.progressStage(DECK_STAGE_IDS.understand, {
      current: index + 1,
      message: `Analyzing source chunk ${index + 1}/${chunks.length}`,
      step: DECK_LLM_CONTENT_ANALYSIS_STAGE,
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

  const result = await runDeckAgentStep(agent, DECK_STAGE_IDS.understand, DECK_LLM_CONTENT_ANALYSIS_MERGE_STAGE, 'Merging content analysis chunks', () => llm.generateObject(createContentAnalysisMergeRequest(inputPath, analyses, options)))

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

function createDeckRewriteStepId(stage: DeckLLMPlanningStage, attempt: number): string {
  return `rewrite-${stage}-${attempt}`
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

  if (rewriteStage === DECK_LLM_SLIDE_OUTLINE_STAGE) {
    const slideOutline = await runDeckAgentStep(input.agent, DECK_STAGE_IDS.outline, createDeckRewriteStepId(DECK_LLM_SLIDE_OUTLINE_STAGE, state.attempt), 'Rewriting slide outline from validation feedback', () => generateSlideOutline(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, input.options, {
      attemptsRemaining,
      invalidOutput: state.stagedPlan.slideOutline,
      issues,
    }))
    const slidePlan = await runDeckAgentStep(input.agent, DECK_STAGE_IDS.planSlides, createDeckRewriteStepId(DECK_LLM_SLIDE_PLAN_STAGE, state.attempt), 'Rebuilding slide plan after outline rewrite', () => generateSlidePlan(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, slideOutline, input.options))

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

    const scriptSemantics = await runDeckAgentStep(input.agent, DECK_STAGE_IDS.script, createDeckRewriteStepId(DECK_LLM_SCRIPT_SEMANTICS_STAGE, state.attempt), 'Rebuilding script semantics after outline rewrite', () => generateScriptSemantics(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, slideOutline, slidePlan, input.options))

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

    const coherenceReview = await runDeckAgentStep(input.agent, DECK_STAGE_IDS.script, createDeckRewriteStepId(DECK_LLM_COHERENCE_REVIEW_STAGE, state.attempt), 'Reviewing rewritten deck plan', () => generateCoherenceReview(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, slideOutline, slidePlan, scriptSemantics, input.options, state.stagedPlan.coherenceReview.issues))

    stagedPlan = {
      analysis: state.stagedPlan.analysis,
      brief: state.stagedPlan.brief,
      coherenceReview,
      options: input.options,
      scriptSemantics,
      slideOutline,
      slidePlan,
    }
  } else if (rewriteStage === DECK_LLM_SLIDE_PLAN_STAGE) {
    const slidePlan = await runDeckAgentStep(input.agent, DECK_STAGE_IDS.planSlides, createDeckRewriteStepId(DECK_LLM_SLIDE_PLAN_STAGE, state.attempt), 'Rewriting slide plan from validation feedback', () => generateSlidePlan(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, input.options, {
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

    const scriptSemantics = await runDeckAgentStep(input.agent, DECK_STAGE_IDS.script, createDeckRewriteStepId(DECK_LLM_SCRIPT_SEMANTICS_STAGE, state.attempt), 'Rebuilding script semantics after slide plan rewrite', () => generateScriptSemantics(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, slidePlan, input.options))

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

    const coherenceReview = await runDeckAgentStep(input.agent, DECK_STAGE_IDS.script, createDeckRewriteStepId(DECK_LLM_COHERENCE_REVIEW_STAGE, state.attempt), 'Reviewing rewritten deck plan', () => generateCoherenceReview(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, slidePlan, scriptSemantics, input.options, state.stagedPlan.coherenceReview.issues))

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
    const scriptSemantics = await runDeckAgentStep(input.agent, DECK_STAGE_IDS.script, createDeckRewriteStepId(DECK_LLM_SCRIPT_SEMANTICS_STAGE, state.attempt), 'Rewriting script semantics from validation feedback', () => generateScriptSemantics(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, state.stagedPlan.slidePlan, input.options, {
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

    const coherenceReview = await runDeckAgentStep(input.agent, DECK_STAGE_IDS.script, createDeckRewriteStepId(DECK_LLM_COHERENCE_REVIEW_STAGE, state.attempt), 'Reviewing rewritten script semantics', () => generateCoherenceReview(llm, input.inputPath, state.stagedPlan.analysis, state.stagedPlan.brief, state.stagedPlan.slideOutline, state.stagedPlan.slidePlan, scriptSemantics, input.options, state.stagedPlan.coherenceReview.issues))

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

    await input.agent?.completeStage(DECK_STAGE_IDS.outline, 'Slide outline complete')
    await input.agent?.completeStage(DECK_STAGE_IDS.planSlides, 'Slide plan complete')
    await input.agent?.completeStage(DECK_STAGE_IDS.script, 'Script semantics and coherence review complete')

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
    source: SOURCE_MAP_ARTIFACT_NAME,
    version: 1,
  })
}

function createDeckBriefArtifact(brief: LLMTextDeckBrief) {
  return DeckBriefSchema.parse({
    ...brief,
    generatedAt: new Date().toISOString(),
    source: CONTENT_ANALYSIS_ARTIFACT_NAME,
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

function createDeckSlideOutlineArtifact(slideOutline: LLMTextDeckSlideOutline) {
  return DeckSlideOutlineSchema.parse({
    ...slideOutline,
    generatedAt: new Date().toISOString(),
    source: DECK_BRIEF_ARTIFACT_NAME,
    version: 1,
  })
}
