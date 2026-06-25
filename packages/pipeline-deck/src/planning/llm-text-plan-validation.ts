import {
  findLLMDeckStructuredTemplateDataRequirement,
  LLMTextDeckValidationError,
  type LLMTextDeckBrief,
  type LLMTextDeckCoherenceReview,
  type LLMTextDeckContentAnalysis,
  type LLMDeckStructuredTemplateDataRequirement,
  type LLMTextDeckScriptSemantics,
  type LLMTextDeckSlideOutline,
  type LLMTextDeckSlidePlan,
  type LLMTextDeckValidationIssue,
} from './llm-plan.js'
import {createDeckPlanningIntent} from './llm-text-plan-input.js'
import {
  DECK_LLM_FINAL_BUILD_STAGE,
  DECK_LLM_SCRIPT_SEMANTICS_STAGE,
  DECK_LLM_SLIDE_OUTLINE_STAGE,
  DECK_LLM_SLIDE_PLAN_STAGE,
  type DeckLLMRewriteStage,
  type DeckLLMValidationStage,
} from './llm-text-plan-stages.js'
import type {TextDeckProjectPlanOptions} from './types.js'
import {assertNoGeneratedTextControlSyntax, cleanGeneratedText} from './utils.js'
import {DECK_COHERENCE_REPORT_ARTIFACT_NAME} from '@video-agent/runtime'

const DECK_LLM_ENGLISH_WORDS_PER_SECOND = 2.6
const DECK_LLM_CJK_CHARACTERS_PER_SECOND = 4.8
const DECK_LLM_TOTAL_TIMING_ESTIMATE_TO_PLAN_RATIO = 1.35
const DECK_LLM_TOTAL_TIMING_GRACE_SECONDS = 3
const DECK_LLM_FORMATTED_ERROR_MESSAGE_MAX_CHARACTERS = 6_000
const DECK_LLM_VISIBLE_DETAIL_CAPACITY_FORBIDDEN_FIXES = [
  'Do not compress source items named by the issue into broader categories.',
  'Do not move required visible detail into speakerNote, semantic metadata, or narration-only text.',
  'Do not turn an output template into a headings-only outline.',
]
const DECK_LLM_VISIBLE_DETAIL_CAPACITY_REQUIRED_ADDITIONS = [
  'If the issue names missing source items, copy those exact item names into visible slide-plan fields instead of summarizing them into categories.',
  'Use a template with enough visible capacity for the full required structure: prefer code.language "text" with code.text as one short line per required item for dense ordered checklists, schemas, report structures, or output templates.',
  'For output-template slides, every code.text line or section must pair the section name with a short field-specific instruction, filled example, required input, or validation condition from the source.',
  'Use process.steps only when the complete visible sequence fits process step limits; otherwise switch to code and keep points empty or as a short summary.',
]
const DECK_LLM_PROCESS_DETAIL_FORBIDDEN_FIXES = [
  'Do not make process.steps[].detail a category label, a "current vs future" contrast, or a generic phrase such as "build a verification chain" without the actual check to run.',
]
const DECK_LLM_PROCESS_DETAIL_REQUIRED_ADDITIONS = [
  'For process slides, each process.steps[].detail must be a visible executable instruction or verification criterion, not just a topic summary.',
  'If the issue names missing questions, checkpoints, confirm/weaken/falsify conditions, observable inputs, metrics, or examples, put those exact concrete items into process.steps[].detail or switch to code.text if they do not fit.',
  'Each repaired process detail should name what the viewer checks and how that observation changes the decision or next step.',
]
const DECK_LLM_PLACEHOLDER_FORBIDDEN_FIXES = [
  'Do not leave a visible line as only a placeholder pattern such as Company / ticker, X/Y/Z, A/B/C, "...", or "原因是..." without explaining how to fill it.',
]
const DECK_LLM_PLACEHOLDER_REQUIRED_ADDITIONS = [
  'When visible text uses placeholders, include the source-required filling instruction or decision rule on the same line, such as what to name, how many sentences to use, what reason or evidence to provide, and what to do when no candidate or multiple candidates exist.',
]
const DECK_LLM_COMPACT_VISIBLE_DETAIL_FORBIDDEN_FIXES = [
  'Do not add long examples, parenthetical examples, or repeated explanatory phrases to every line of a dense output template when a short field rule would satisfy the issue.',
  'Do not duplicate the same template content in both points and code.text; keep points empty or as one short caption when code.text carries the dense structure.',
  'Do not shrink dense templates to headings plus symbol-only shorthand such as "公司+因", "证据3项", or "关键检查点" as the whole field rule.',
  'Do not use empty verbs such as "summarize", "list", "evaluate", "概述", "列出", "评估", or "明确" as the main instruction without naming the concrete input, rule, threshold, example, or decision condition.',
]
const DECK_LLM_COMPACT_VISIBLE_DETAIL_REQUIRED_ADDITIONS = [
  'Keep the repaired slide within maxSlideCharacters while adding detail; count title, subtitle, points, and structured visible text together.',
  'For dense output templates, schemas, and report structures, prefer terse "Field: fill rule" lines over examples, but every fill rule must name a concrete input, condition, example, or decision branch.',
  'Use compact field rules such as "Field: required input + decision condition" rather than full sentences when the source requires many visible sections.',
  'When issue.message names exact source examples, treat those named examples as required visible content and place them in the relevant field rule instead of replacing them with generic phrases.',
  'If a field depends on another workflow step or validation chain, name the referenced step, metric, or checkpoint instead of writing a generic phrase such as "key checkpoints".',
]

export type DeckPlanningRepairStrategy = 'rebalanceTimingOrNarration' | 'requireOperationalCriteria' | 'requirePracticalDetail' | 'requireTemplateReplan' | 'requireTransitionLogic' | 'satisfyValidation'

export type DeckPlanningValidationIssue = Omit<LLMTextDeckValidationIssue, 'stage'> & {
  escalationReason?: string
  forbiddenFixes?: string[]
  repairStrategy?: DeckPlanningRepairStrategy
  repeatCount?: number
  requiredAdditions?: string[]
  stage: DeckLLMValidationStage
}

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

export function validateLLMTextDeckSlideCount(
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
      stage: DECK_LLM_SLIDE_OUTLINE_STAGE,
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
      stage: DECK_LLM_SLIDE_OUTLINE_STAGE,
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
      stage: DECK_LLM_SLIDE_OUTLINE_STAGE,
    })
  }

  if (issues.length > 0) {
    throw new LLMTextDeckValidationError(issues)
  }
}

export function validateLLMTextDeckSlideOutlineCoverage(
  analysis: LLMTextDeckContentAnalysis,
  brief: LLMTextDeckBrief,
  slideOutline: LLMTextDeckSlideOutline,
): void {
  const covered = new Set(slideOutline.slides.flatMap((slide) => slide.sourceSectionIds))
  const requiredSectionIds = uniqueStrings([
    ...brief.requiredSectionIds,
    ...analysis.sections.filter((section) => section.mustCover).map((section) => section.id),
  ])
  const missing = requiredSectionIds.filter((sectionId) => !covered.has(sectionId))

  if (missing.length === 0) {
    return
  }

  throw new LLMTextDeckValidationError([{
    actual: requiredSectionIds.length - missing.length,
    code: 'SOURCE_COVERAGE',
    field: 'sourceSectionIds',
    limit: requiredSectionIds.length,
    message: `Deck slide outline does not cover ${missing.length} required source section(s): ${missing.join(', ')}. Rewrite the slide outline before generating slides.`,
    path: 'slideOutline.slides[].sourceSectionIds',
    stage: DECK_LLM_SLIDE_OUTLINE_STAGE,
  }])
}

export function validateLLMTextDeckScriptSemanticsStructure(
  scriptSemantics: LLMTextDeckScriptSemantics,
  slideOutline: LLMTextDeckSlideOutline,
): void {
  validateLLMTextDeckScriptSemanticsCardinality(scriptSemantics, slideOutline)
  validateLLMTextDeckScriptSemanticsText(scriptSemantics)
}

export function validateLLMTextDeckSlidePlanStructure(
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
      stage: DECK_LLM_SLIDE_PLAN_STAGE,
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
      stage: DECK_LLM_SLIDE_PLAN_STAGE,
    })
    break
  }

  if (issues.length > 0) {
    throw new LLMTextDeckValidationError(issues)
  }
}

export function validateLLMTextDeckScriptSemanticsTiming(
  scriptSemantics: LLMTextDeckScriptSemantics,
  slideOutline: LLMTextDeckSlideOutline,
  options: TextDeckProjectPlanOptions,
): void {
  const issues: LLMTextDeckValidationIssue[] = []
  const plannedDuration = scriptSemantics.slides.reduce((sum, slide) => sum + slide.duration, 0)
  const targetDuration = options.durationTargetSeconds
  const estimatedSpeechDuration = scriptSemantics.slides.reduce((sum, slide, index) => sum + estimateSpeakerNoteSeconds(slide.speakerNote, options.language, index), 0)
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
      stage: DECK_LLM_SCRIPT_SEMANTICS_STAGE,
    })
  }

  if (issues.length > 0) {
    throw new LLMTextDeckValidationError(issues)
  }
}

export function speakerNoteCharactersForSeconds(seconds: number): number {
  return requireSpeakerNoteBudgetUnits(
    Math.floor(requireSpeakerNoteBudgetSeconds(seconds) * DECK_LLM_CJK_CHARACTERS_PER_SECOND),
    seconds,
    'characters',
  )
}

export function speakerNoteWordsForSeconds(seconds: number): number {
  return requireSpeakerNoteBudgetUnits(
    Math.floor(requireSpeakerNoteBudgetSeconds(seconds) * DECK_LLM_ENGLISH_WORDS_PER_SECOND),
    seconds,
    'words',
  )
}

function requireSpeakerNoteBudgetSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError(`Deck speaker note budget seconds must be positive and finite; no suggested speaker note budget fallback is allowed. Received: ${String(seconds)}`)
  }

  return seconds
}

function requireSpeakerNoteBudgetUnits(count: number, seconds: number, unit: 'characters' | 'words'): number {
  if (count < 1) {
    throw new RangeError(`Deck speaker note budget ${seconds}s is too short to produce a positive ${unit} suggestion; no minimum suggestion fallback is allowed.`)
  }

  return count
}

export function normalizeCoherenceReview(
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

export function assertCoherenceReview(review: LLMTextDeckCoherenceReview): void {
  const errors = review.issues.filter((issue) => normalizedCoherenceIssueSeverity(issue) === 'error')

  if (errors.length === 0) {
    return
  }

  throw new DeckCoherenceReviewValidationError(errors.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ...(issue.path === undefined ? {} : {path: issue.path}),
    ...normalizeIssueSlideIndex(issue),
    stage: issue.stage,
  })))
}

export function normalizedCoherenceIssueSeverity(issue: LLMTextDeckCoherenceReview['issues'][number]): 'error' | 'warning' {
  if (isGlobalDurationBudgetIssue(issue)) {
    return 'warning'
  }

  return issue.severity
}

function normalizeIssueSlideIndex(issue: Pick<LLMTextDeckCoherenceReview['issues'][number], 'message' | 'path' | 'slideIndex'>): {slideIndex?: number} {
  const slideIndex = issue.slideIndex ?? parseSlideIndexFromPath(issue.path) ?? parseSlideIndex(issue.message)

  return slideIndex === undefined ? {} : {slideIndex}
}

export function createDeckPlanningValidationIssues(error: unknown): DeckPlanningValidationIssue[] {
  if (error instanceof LLMTextDeckValidationError) {
    return error.issues
  }

  if (error instanceof DeckCoherenceReviewValidationError) {
    return error.issues
  }

  const message = formatErrorMessage(error)
  const path = parseIssuePath(message)
  const slideIndex = parseSlideIndexFromPath(path) ?? parseSlideIndex(message)

  return [{
    code: classifyIssueCode(message),
    message,
    ...(path === undefined ? {} : {path}),
    ...(slideIndex === undefined ? {} : {slideIndex}),
    stage: classifyValidationStage(message),
  }]
}

export function createDeckPlanningRepairIssues(
  issues: DeckPlanningValidationIssue[],
  issueHistory: DeckPlanningValidationIssue[][],
): DeckPlanningValidationIssue[] {
  return includeVisibleDetailRepairContext(issues, issueHistory).map((issue) => {
    const repeatCount = countPreviousMatchingIssues(issue, issueHistory) + 1
    const repair = createDeckPlanningRepairContract(issue)
    const shouldEscalateToSlidePlan = issue.stage === DECK_LLM_SCRIPT_SEMANTICS_STAGE && repeatCount >= 2 && shouldEscalateRepeatedScriptIssue(issue)

    return {
      ...issue,
      ...repair,
      repeatCount,
      ...(shouldEscalateToSlidePlan
        ? {
            escalationReason: `This ${issue.code} issue for the same slide/path has survived ${repeatCount} rewrite attempt(s); update visible slide structure before rebuilding script semantics.`,
            stage: DECK_LLM_SLIDE_PLAN_STAGE,
          }
        : {}),
    }
  })
}

function includeVisibleDetailRepairContext(
  issues: DeckPlanningValidationIssue[],
  issueHistory: DeckPlanningValidationIssue[][],
): DeckPlanningValidationIssue[] {
  if (!shouldCarryForwardVisibleDetailIssues(issues)) {
    return issues
  }

  const contextIssues = findLatestVisibleDetailIssueContext(issueHistory)
    .filter((issue) => !issues.some((current) => createDeckPlanningIssueSignature(current) === createDeckPlanningIssueSignature(issue)))

  return contextIssues.length === 0 ? issues : [...issues, ...contextIssues]
}

function shouldCarryForwardVisibleDetailIssues(issues: DeckPlanningValidationIssue[]): boolean {
  return issues.some((issue) => issue.stage === DECK_LLM_SLIDE_PLAN_STAGE && !isVisibleDetailRepairIssue(issue))
}

function findLatestVisibleDetailIssueContext(issueHistory: DeckPlanningValidationIssue[][]): DeckPlanningValidationIssue[] {
  for (const issues of [...issueHistory].reverse()) {
    if (issues.length === 0) {
      return []
    }

    const visibleDetailIssues = issues.filter((issue) => issue.stage === DECK_LLM_SLIDE_PLAN_STAGE && isVisibleDetailRepairIssue(issue))

    if (visibleDetailIssues.length > 0) {
      return visibleDetailIssues
    }
  }

  return []
}

function isVisibleDetailRepairIssue(issue: DeckPlanningValidationIssue): boolean {
  return issue.code === 'LOW_INFORMATION_DEPTH' || issue.code === 'MISSING_PRACTICAL_DETAIL' || issue.code === 'COHERENCE_GAP'
}

export function chooseRewriteStage(issues: DeckPlanningValidationIssue[]): DeckLLMRewriteStage {
  if (issues.some((issue) => issue.stage === DECK_LLM_SLIDE_OUTLINE_STAGE)) {
    return DECK_LLM_SLIDE_OUTLINE_STAGE
  }

  return issues.some((issue) => issue.stage === DECK_LLM_SLIDE_PLAN_STAGE) ? DECK_LLM_SLIDE_PLAN_STAGE : DECK_LLM_SCRIPT_SEMANTICS_STAGE
}

export function formatErrorMessage(error: unknown): string {
  const messages = uniqueStrings([
    formatUnknownErrorMessage(error),
    ...collectNestedErrorMessages(error),
  ]).filter((message) => message.length > 0)
  const formatted = messages.length === 0 ? String(error) : messages.join('\nCaused by: ')

  return formatted.length <= DECK_LLM_FORMATTED_ERROR_MESSAGE_MAX_CHARACTERS
    ? formatted
    : `${formatted.slice(0, DECK_LLM_FORMATTED_ERROR_MESSAGE_MAX_CHARACTERS)}...`
}

function collectNestedErrorMessages(error: unknown, seen = new Set<unknown>()): string[] {
  if (error === null || typeof error !== 'object' || seen.has(error)) {
    return []
  }

  seen.add(error)

  const record = error as Record<string, unknown>
  const details = record.details
  const detailsRecord = details !== null && typeof details === 'object'
    ? details as Record<string, unknown>
    : undefined
  const nested = [
    record.cause,
    detailsRecord?.cause,
    detailsRecord?.error,
  ].filter((value) => value !== undefined)

  return nested.flatMap((value) => [
    formatUnknownErrorMessage(value),
    ...collectNestedErrorMessages(value, seen),
  ])
}

function formatUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return compactValidationErrorMessage(error.message)
  }

  if (error !== null && typeof error === 'object' && 'message' in error && typeof (error as {message?: unknown}).message === 'string') {
    return compactValidationErrorMessage((error as {message: string}).message)
  }

  return compactValidationErrorMessage(String(error))
}

function compactValidationErrorMessage(message: string): string {
  const marker = 'Error message:'
  const markerIndex = message.indexOf(marker)

  if (markerIndex === -1) {
    return message
  }

  return `Schema validation ${message.slice(markerIndex).trim()}`
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
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
      stage: DECK_LLM_SCRIPT_SEMANTICS_STAGE,
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
        stage: DECK_LLM_SCRIPT_SEMANTICS_STAGE,
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
      stage: DECK_LLM_SCRIPT_SEMANTICS_STAGE,
    })
  }
}

function estimateSpeakerNoteSeconds(text: string, language: string, index: number): number {
  if (isCjkLanguage(language) || containsCjk(text)) {
    const characters = countCjkAwareCharacters(text)

    if (characters === 0) {
      throw new Error(`Deck script semantics slide ${index + 1} speakerNote requires non-empty speech text; no minimum speakerNote-duration fallback is allowed.`)
    }

    return characters / DECK_LLM_CJK_CHARACTERS_PER_SECOND
  }

  const words = countWords(text)

  if (words === 0) {
    throw new Error(`Deck script semantics slide ${index + 1} speakerNote requires non-empty speech text; no minimum speakerNote-duration fallback is allowed.`)
  }

  return words / DECK_LLM_ENGLISH_WORDS_PER_SECOND
}

function countWords(text: string): number {
  const words = text.trim().match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/gu)

  return words?.length ?? 0
}

function countCjkAwareCharacters(text: string): number {
  return [...text.replace(/\s+/gu, '')].length
}

export function isCjkLanguage(language: string): boolean {
  return /^(zh|ja|ko)\b/iu.test(language)
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/u.test(text)
}

function roundTimingIssueValue(value: number): number {
  return Math.round(value * 100) / 100
}

function createCoherenceIssueRepeatKey(issue: LLMTextDeckCoherenceReview['issues'][number]): string {
  return [
    issue.code,
    issue.slideIndex ?? parseSlideIndexFromPath(issue.path) ?? parseSlideIndex(issue.message) ?? 'global',
    issue.path ?? 'no-path',
    issue.stage,
  ].join('|')
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
    issue.slideIndex ?? parseSlideIndexFromPath(issue.path) ?? 'global',
    issue.path ?? 'no-path',
  ].join('|')
}

function createDeckPlanningRepairContract(issue: DeckPlanningValidationIssue): Pick<DeckPlanningValidationIssue, 'forbiddenFixes' | 'repairStrategy' | 'requiredAdditions'> {
  if (issue.code === 'TEXT_CLEANLINESS' || issue.code === 'SCRIPT_TEXT_FIELD_CLEANLINESS') {
    return createTextCleanlinessRepairContract(issue)
  }

  if (issue.code === 'TEMPLATE_REQUIRED_DATA_MISSING') {
    return createStructuredTemplateDataRepairContract(issue, 'missing')
  }

  if (issue.code === 'TEMPLATE_EXTRANEOUS_DATA') {
    return createStructuredTemplateDataRepairContract(issue, 'extraneous')
  }

  if (issue.code === 'TEMPLATE_TEXT_LENGTH_LIMIT') {
    return createTemplateTextLengthRepairContract(issue)
  }

  if (issue.code === 'LOW_INFORMATION_DEPTH') {
    return {
      forbiddenFixes: [
        'Do not only restate the existing headline, formula, or visible points.',
        'Do not add generic adjectives such as clear, actionable, important, or practical without criteria.',
        ...DECK_LLM_PLACEHOLDER_FORBIDDEN_FIXES,
        ...DECK_LLM_COMPACT_VISIBLE_DETAIL_FORBIDDEN_FIXES,
        ...DECK_LLM_VISIBLE_DETAIL_CAPACITY_FORBIDDEN_FIXES,
      ],
      repairStrategy: 'requireOperationalCriteria',
      requiredAdditions: [
        'Name the missing concrete method or decision criteria described by the issue.',
        'Add at least one source-grounded way to estimate, verify, or apply the concept.',
        'Add one compact example, field rule, or judgment sentence that shows how the viewer would use the concept.',
        ...DECK_LLM_PLACEHOLDER_REQUIRED_ADDITIONS,
        ...DECK_LLM_COMPACT_VISIBLE_DETAIL_REQUIRED_ADDITIONS,
        ...DECK_LLM_VISIBLE_DETAIL_CAPACITY_REQUIRED_ADDITIONS,
      ],
    }
  }

  if (issue.code === 'MISSING_PRACTICAL_DETAIL') {
    return {
      forbiddenFixes: [
        'Do not replace missing detail with a broad summary.',
        'Do not leave placeholders such as X/Y/company without explaining how to fill them.',
        ...DECK_LLM_PROCESS_DETAIL_FORBIDDEN_FIXES,
        ...DECK_LLM_PLACEHOLDER_FORBIDDEN_FIXES,
        ...DECK_LLM_COMPACT_VISIBLE_DETAIL_FORBIDDEN_FIXES,
        ...DECK_LLM_VISIBLE_DETAIL_CAPACITY_FORBIDDEN_FIXES,
      ],
      repairStrategy: 'requirePracticalDetail',
      requiredAdditions: [
        'Add concrete thresholds, observable inputs, examples, or decision branches requested by the issue.',
        'If the issue asks for scoring, scale, or score-band detail, include the visible score scale meaning, named scoring criteria, and how score results change priority or action.',
        'If a scoring issue names more than four dimensions or asks for score-to-action mapping, switch from chart to code.text or process.steps so all dimensions, scale meanings, and decision bands are visible.',
        'Explain what the viewer should check and how the result changes the recommendation or next step.',
        ...DECK_LLM_PROCESS_DETAIL_REQUIRED_ADDITIONS,
        ...DECK_LLM_PLACEHOLDER_REQUIRED_ADDITIONS,
        ...DECK_LLM_COMPACT_VISIBLE_DETAIL_REQUIRED_ADDITIONS,
        ...DECK_LLM_VISIBLE_DETAIL_CAPACITY_REQUIRED_ADDITIONS,
      ],
    }
  }

  if (issue.code === 'VISIBLE_TEXT_LIMIT') {
    return {
      forbiddenFixes: [
        'Do not satisfy a character-limit issue by deleting source-required structure or leaving a headings-only outline.',
        ...DECK_LLM_COMPACT_VISIBLE_DETAIL_FORBIDDEN_FIXES,
      ],
      repairStrategy: 'requireTemplateReplan',
      requiredAdditions: [
        'Rewrite the reported slide so total visible text is within maxSlideCharacters, including title, subtitle, points, and structured template text.',
        'For dense output templates, schemas, and report structures, use code.language "text" with one short "Field: fill rule" line per required item.',
        'Remove repeated examples, parenthetical examples, filler words, and duplicate points before removing source-required items.',
        'Keep the source-required filling rules visible in compact form.',
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

function createTextCleanlinessRepairContract(issue: DeckPlanningValidationIssue): Pick<DeckPlanningValidationIssue, 'forbiddenFixes' | 'repairStrategy' | 'requiredAdditions'> {
  return {
    forbiddenFixes: [
      'Do not keep leading, trailing, repeated, tab, carriage-return, or newline whitespace in generated text fields.',
      'Do not use spacing to separate multiple logical items inside one point.',
      'Do not use Markdown bullets, tables, headings, blockquotes, fences, or page-number prefixes in visible text fields.',
    ],
    repairStrategy: issue.stage === DECK_LLM_SLIDE_PLAN_STAGE ? 'requireTemplateReplan' : 'satisfyValidation',
    requiredAdditions: [
      'Rewrite the reported field as clean single-line text with normal single spaces only.',
      'If the field is trying to contain multiple steps, split the content into the appropriate visible structure: points for short parallel items, process.steps for ordered flows, comparison sides for two-way contrasts, or code.text for dense lists/schemas/templates.',
      'Keep the source meaning unchanged while satisfying the exact reported path.',
    ],
  }
}

function createTemplateTextLengthRepairContract(issue: DeckPlanningValidationIssue): Pick<DeckPlanningValidationIssue, 'forbiddenFixes' | 'repairStrategy' | 'requiredAdditions'> {
  return {
    forbiddenFixes: [
      'Do not fix a text-length issue only by changing unrelated fields; the reported path itself must fit the reported limit.',
      'Do not keep long sentence examples inside point fields with tight template limits.',
      ...DECK_LLM_COMPACT_VISIBLE_DETAIL_FORBIDDEN_FIXES,
    ],
    repairStrategy: 'requireTemplateReplan',
    requiredAdditions: [
      `Rewrite ${issue.path ?? 'the reported visible field'} so it is at or below ${issue.limit ?? 'the reported'} characters.`,
      'For title or subtitle fields, shorten the reported field itself and move explanatory wording into a visible structured field with enough capacity.',
      'For point fields, use a compact phrase, formula, or placeholder rule instead of a full sentence example.',
      'After fixing the reported point-like field, scan sibling points, comparison points, and chart labels on the same slide for the same template limit before returning.',
      'When the template point limit is 40 characters, prefer 36 characters or fewer to avoid off-by-one counting failures.',
      'If the required detail cannot fit the current template point limit, switch to a registered template with enough visible capacity, such as code.text or process.steps, and fill its required structured data.',
      'Preserve the source meaning and any required practical detail while satisfying the exact field limit.',
    ],
  }
}

function createStructuredTemplateDataRepairContract(
  issue: DeckPlanningValidationIssue,
  kind: 'extraneous' | 'missing',
): Pick<DeckPlanningValidationIssue, 'forbiddenFixes' | 'repairStrategy' | 'requiredAdditions'> {
  const requirement = findLLMDeckStructuredTemplateDataRequirement(issue.field ?? issue.template)

  if (requirement === undefined) {
    return {
      repairStrategy: 'requireTemplateReplan',
      requiredAdditions: [
        'Make the slide type and any template-specific structured fields match exactly.',
        'Use only registered templates and remove structured fields that belong to another template.',
      ],
    }
  }

  return kind === 'missing'
    ? createMissingStructuredTemplateDataRepairContract(requirement)
    : createExtraneousStructuredTemplateDataRepairContract(requirement)
}

function createMissingStructuredTemplateDataRepairContract(
  requirement: LLMDeckStructuredTemplateDataRequirement,
): Pick<DeckPlanningValidationIssue, 'forbiddenFixes' | 'repairStrategy' | 'requiredAdditions'> {
  return {
    forbiddenFixes: [
      `Do not keep type "${requirement.type}" without the ${requirement.field} object.`,
      `Do not use points, title, visual.kind, speakerNote, or semantic metadata as a substitute for ${requirement.label}.`,
    ],
    repairStrategy: 'requireTemplateReplan',
    requiredAdditions: [
      `Either keep type "${requirement.type}" and provide ${requirement.field} with required fields: ${requirement.requiredFields.join(', ')}; or switch to a registered template whose required data can be fully provided.`,
      `If switching templates, remove ${requirement.field} and make visual.kind match the new visible structure.`,
      'Preserve the slide source meaning while also satisfying point count and character limits.',
    ],
  }
}

function createExtraneousStructuredTemplateDataRepairContract(
  requirement: LLMDeckStructuredTemplateDataRequirement,
): Pick<DeckPlanningValidationIssue, 'forbiddenFixes' | 'repairStrategy' | 'requiredAdditions'> {
  return {
    forbiddenFixes: [
      `Do not leave ${requirement.field} on a non-${requirement.type} slide.`,
    ],
    repairStrategy: 'requireTemplateReplan',
    requiredAdditions: [
      `Either change type to "${requirement.type}" and provide complete ${requirement.field} fields: ${requirement.requiredFields.join(', ')}; or remove ${requirement.field} from the slide.`,
      'Keep visible text, visual.kind, and template-specific data consistent with the final slide type.',
    ],
  }
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
    return DECK_LLM_SLIDE_OUTLINE_STAGE
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
    return DECK_LLM_SLIDE_PLAN_STAGE
  }

  if (
    message.includes('speakerNote')
    || message.includes('sourceRange')
    || message.includes('semantic')
    || message.includes(DECK_LLM_SCRIPT_SEMANTICS_STAGE)
    || message.includes('outline')
    || message.includes('claim')
    || message.includes('moment')
  ) {
    return DECK_LLM_SCRIPT_SEMANTICS_STAGE
  }

  return DECK_LLM_FINAL_BUILD_STAGE
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

  if (
    message.includes('contains repeated whitespace')
    || message.includes('contains layout whitespace')
    || message.includes('contains leading or trailing whitespace')
    || message.includes('contains Markdown control syntax')
    || message.includes('contains Markdown table syntax')
    || message.includes('contains Markdown code fences')
    || message.includes('contains YAML frontmatter')
    || message.includes('contains a page-number prefix')
  ) {
    return 'TEXT_CLEANLINESS'
  }

  if (message.includes(DECK_LLM_SCRIPT_SEMANTICS_STAGE)) {
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
  const zeroBasedMatch = /slide[-_\s]*index\s*[:=]?\s*(\d+)|slideIndex\s*[:=]?\s*(\d+)/iu.exec(message)

  if (zeroBasedMatch?.[1] !== undefined || zeroBasedMatch?.[2] !== undefined) {
    return Number.parseInt(zeroBasedMatch[1] ?? zeroBasedMatch[2] ?? '', 10)
  }

  const match = /slide\s+(\d+)/iu.exec(message)

  if (match?.[1] === undefined) {
    return undefined
  }

  return Number.parseInt(match[1], 10) - 1
}

function parseSlideIndexFromPath(path: string | undefined): number | undefined {
  const match = /slides\[(\d+)\]/iu.exec(path ?? '')

  if (match?.[1] === undefined) {
    return undefined
  }

  return Number.parseInt(match[1], 10)
}

function parseIssuePath(message: string): string | undefined {
  if (message.includes('Deck coherence review requires')) {
    return parseCoherenceIssuePath(message) ?? DECK_COHERENCE_REPORT_ARTIFACT_NAME
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

  if (message.includes(DECK_LLM_SCRIPT_SEMANTICS_STAGE)) {
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

function parseCoherenceRewriteStage(message: string): DeckLLMRewriteStage | undefined {
  const match = /Deck coherence review requires (slide-outline|slide-plan|script-semantics) rewrite/u.exec(message)

  if (match?.[1] === DECK_LLM_SLIDE_OUTLINE_STAGE || match?.[1] === DECK_LLM_SLIDE_PLAN_STAGE || match?.[1] === DECK_LLM_SCRIPT_SEMANTICS_STAGE) {
    return match[1] as DeckLLMRewriteStage
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
