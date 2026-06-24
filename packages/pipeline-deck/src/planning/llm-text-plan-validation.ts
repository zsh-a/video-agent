import {
  findLLMDeckStructuredTemplateDataRequirement,
  LLMTextDeckValidationError,
  type LLMTextDeckCoherenceReview,
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
]
const DECK_LLM_VISIBLE_DETAIL_CAPACITY_REQUIRED_ADDITIONS = [
  'If the issue names missing source items, copy those exact item names into visible slide-plan fields instead of summarizing them into categories.',
  'Use a template with enough visible capacity for the full required structure: prefer code.language "text" with code.text as one short line per required item for dense ordered checklists, schemas, report structures, or output templates.',
  'Use process.steps only when the complete visible sequence fits process step limits; otherwise switch to code and keep points empty or as a short summary.',
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
    ...(issue.slideIndex === undefined ? {} : {slideIndex: issue.slideIndex}),
    stage: issue.stage,
  })))
}

export function normalizedCoherenceIssueSeverity(issue: LLMTextDeckCoherenceReview['issues'][number]): 'error' | 'warning' {
  if (isGlobalDurationBudgetIssue(issue)) {
    return 'warning'
  }

  return issue.severity
}

export function createDeckPlanningValidationIssues(error: unknown): DeckPlanningValidationIssue[] {
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

export function createDeckPlanningRepairIssues(
  issues: DeckPlanningValidationIssue[],
  issueHistory: DeckPlanningValidationIssue[][],
): DeckPlanningValidationIssue[] {
  return issues.map((issue) => {
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
    issue.slideIndex ?? 'global',
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
    issue.slideIndex ?? 'global',
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

  if (issue.code === 'LOW_INFORMATION_DEPTH') {
    return {
      forbiddenFixes: [
        'Do not only restate the existing headline, formula, or visible points.',
        'Do not add generic adjectives such as clear, actionable, important, or practical without criteria.',
        ...DECK_LLM_VISIBLE_DETAIL_CAPACITY_FORBIDDEN_FIXES,
      ],
      repairStrategy: 'requireOperationalCriteria',
      requiredAdditions: [
        'Name the missing concrete method or decision criteria described by the issue.',
        'Add at least one source-grounded way to estimate, verify, or apply the concept.',
        'Add one compact example or judgment sentence that shows how the viewer would use the concept.',
        ...DECK_LLM_VISIBLE_DETAIL_CAPACITY_REQUIRED_ADDITIONS,
      ],
    }
  }

  if (issue.code === 'MISSING_PRACTICAL_DETAIL') {
    return {
      forbiddenFixes: [
        'Do not replace missing detail with a broad summary.',
        'Do not leave placeholders such as X/Y/company without explaining how to fill them.',
        ...DECK_LLM_VISIBLE_DETAIL_CAPACITY_FORBIDDEN_FIXES,
      ],
      repairStrategy: 'requirePracticalDetail',
      requiredAdditions: [
        'Add concrete thresholds, observable inputs, examples, or decision branches requested by the issue.',
        'If the issue asks for scoring, scale, or score-band detail, include the visible score scale meaning, named scoring criteria, and how score results change priority or action.',
        'Explain what the viewer should check and how the result changes the recommendation or next step.',
        ...DECK_LLM_VISIBLE_DETAIL_CAPACITY_REQUIRED_ADDITIONS,
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
  const match = /slide\s+(\d+)/iu.exec(message)

  if (match?.[1] === undefined) {
    return undefined
  }

  return Number.parseInt(match[1], 10) - 1
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
