import type {GenerateObjectRequest, LLMMessage} from '@video-agent/llm'

import {createHash} from 'node:crypto'

import {createObjectPromptRequest} from '@video-agent/llm'

import {
  LLM_DECK_STRUCTURED_TEMPLATE_DATA_REQUIREMENTS,
  LLMTextDeckBriefSchema,
  LLMTextDeckCoherenceReviewSchema,
  LLMTextDeckContentAnalysisSchema,
  LLMTextDeckScriptSemanticsGenerationSchema,
  LLMTextDeckSlideOutlineSchema,
  LLMTextDeckSlidePlanGenerationSchema,
  type LLMTextDeckBrief,
  type LLMTextDeckCoherenceReview,
  type LLMTextDeckContentAnalysis,
  type LLMTextDeckScriptSemanticsGeneration,
  type LLMTextDeckScriptSemantics,
  type LLMTextDeckSlideOutline,
  type LLMTextDeckSlidePlanGeneration,
  type LLMTextDeckSlidePlan,
} from './llm-plan.js'
import {createDeckPlanningTarget, requireDeckPlanningSourceType, type DeckPlanningSourceChunk} from './llm-text-plan-input.js'
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
import {isCjkLanguage, speakerNoteCharactersForSeconds, speakerNoteWordsForSeconds, type DeckPlanningValidationIssue} from './llm-text-plan-validation.js'
import type {createDeckSourceMap} from './source-map.js'
import type {TextDeckProjectPlanOptions} from './types.js'

const DECK_LLM_CACHE_KEY_HASH_CHARACTERS = 24
const DECK_PROMPT_VERSION = '2026-06-25'

type DeckSourceMap = ReturnType<typeof createDeckSourceMap>

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
  schemaDescription?: string
  schemaName: string
  stage: DeckLLMPlanningStage
  temperature: number
}): GenerateObjectRequest<TOutput> {
  return createObjectPromptRequest({
    buildMessages: input.buildMessages,
    cache: (_promptInput, messages) => createDeckLLMCacheHint(input.stage, requireFirstPromptMessage(messages, input.id)),
    id: input.id,
    schema: input.schema,
    ...(input.schemaDescription === undefined ? {} : {schemaDescription: input.schemaDescription}),
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

export function createContentAnalysisRequest(
  inputPath: string,
  chunk: DeckPlanningSourceChunk,
  sourceMap: DeckSourceMap,
  options: TextDeckProjectPlanOptions,
): GenerateObjectRequest<LLMTextDeckContentAnalysis> {
  return createDeckObjectPromptRequest({
    buildMessages: (promptInput) => [createContentAnalysisMessage(promptInput.inputPath, promptInput.chunk, promptInput.sourceMap, promptInput.options)],
    id: 'deck.content-analysis',
    promptInput: {chunk, inputPath, options, sourceMap},
    schema: LLMTextDeckContentAnalysisSchema,
    schemaDescription: 'Deck content analysis object. Root must contain language, title, summary, and sections. Every sections[] item must contain id, importance, keyClaims, mustCover, role, summary, and title. keyClaims must be an array of objects with confidence, sourceQuoteText, text, and type.',
    schemaName: 'LLMTextDeckContentAnalysis',
    stage: DECK_LLM_CONTENT_ANALYSIS_STAGE,
    temperature: 0.2,
  })
}

function createContentAnalysisMessage(inputPath: string, chunk: DeckPlanningSourceChunk, sourceMap: DeckSourceMap, options: TextDeckProjectPlanOptions): LLMMessage {
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
        'Follow outputContract exactly. Use the listed field names, object shapes, and enum values; omit fields only when outputContract says optional.',
      ],
      outputContract: createContentAnalysisOutputContract(),
      source: {
        chunkId: chunk.chunkId,
        durationSeconds: options.durationTargetSeconds,
        path: inputPath,
        sourceMap,
        sourceType: requireDeckPlanningSourceType(options.sourceType),
        text: chunk.text,
        transcriptSegments: chunk.transcriptSegments,
      },
      stage: DECK_LLM_CONTENT_ANALYSIS_STAGE,
      target: createDeckPlanningTarget(options, {includeTemplateManifest: false}),
    }),
    role: 'user',
  }
}

function createContentAnalysisOutputContract() {
  return {
    root: {
      optional: ['audience'],
      required: ['language', 'title', 'summary', 'sections'],
    },
    section: {
      forbiddenFieldNames: ['analysis', 'caveats', 'coverageNotes', 'evidence', 'examples', 'heading'],
      optional: ['sourceRange', 'visualRole'],
      required: ['id', 'importance', 'keyClaims', 'mustCover', 'role', 'summary', 'title'],
    },
    sectionShape: {
      id: 'copy exactly from sourceMap.sections[].id',
      importance: 'number from 0 to 1',
      keyClaims: [{
        confidence: 'number from 0 to 1',
        sourceQuoteText: 'non-empty source-grounded quote or short source excerpt',
        text: 'non-empty claim text',
        type: 'one of: claim, data, recommendation, summary',
      }],
      mustCover: 'boolean',
      role: 'short semantic purpose label',
      sourceRange: 'optional [startNumber, endNumber]',
      summary: 'non-empty section summary; do not use analysis instead',
      title: 'non-empty section title; do not use heading instead',
      visualRole: 'optional short visual purpose label',
    },
  }
}

export function createContentAnalysisMergeRequest(
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
      stage: DECK_LLM_CONTENT_ANALYSIS_MERGE_STAGE,
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
    stage: DECK_LLM_CONTENT_ANALYSIS_MERGE_STAGE,
    temperature: 0.2,
  })
}

export function createDeckBriefRequest(
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
        'Follow outputContract exactly. Return only Deck brief fields at the JSON root; do not wrap them or copy the content-analysis object.',
      ],
      inputPath: promptInput.inputPath,
      outputContract: createDeckBriefOutputContract(),
      stage: DECK_LLM_DECK_BRIEF_STAGE,
      target: createDeckPlanningTarget(promptInput.options, {includeTemplateManifest: false}),
    }),
      role: 'user',
    }],
    id: 'deck.brief',
    promptInput: {analysis, inputPath, options},
    schema: LLMTextDeckBriefSchema,
    schemaDescription: 'Deck brief object. Root must contain densityPolicy, language, narrativeArc, objective, optionalSectionIds, requiredSectionIds, styleIntent, targetDurationSeconds, targetSlideCount, and title. narrativeArc, optionalSectionIds, and requiredSectionIds must be arrays. Do not return sections, slides, slidePlan, output, deckBrief, or content-analysis fields.',
    schemaName: 'LLMTextDeckBrief',
    stage: DECK_LLM_DECK_BRIEF_STAGE,
    temperature: 0.2,
  })
}

function createDeckBriefOutputContract() {
  return {
    forbiddenRootFieldNames: ['analysis', 'deckBrief', 'output', 'sections', 'slidePlan', 'slides', 'summary'],
    root: {
      optional: ['audience'],
      required: [
        'densityPolicy',
        'language',
        'narrativeArc',
        'objective',
        'optionalSectionIds',
        'requiredSectionIds',
        'styleIntent',
        'targetDurationSeconds',
        'targetSlideCount',
        'title',
      ],
    },
    rootShape: {
      densityPolicy: 'non-empty string with concrete generation guidance',
      language: 'target language string, for example zh-CN',
      narrativeArc: ['array of one or more non-empty strings; do not return one paragraph string'],
      objective: 'non-empty string describing the deck objective',
      optionalSectionIds: ['array of source section ids that may be omitted; use [] when none'],
      requiredSectionIds: ['array of must-cover analysis.sections ids; preserve ids exactly'],
      styleIntent: 'non-empty string describing presentation style intent',
      targetDurationSeconds: 'positive number',
      targetSlideCount: 'positive integer, maximum 24',
      title: 'non-empty deck title',
    },
  }
}

export function createSlideOutlineRequest(
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
        'Follow outputContract exactly. Return root slides, not outline. Do not include slide title or visible text in this stage.',
      ],
      inputPath,
      outputContract: createSlideOutlineOutputContract(),
      stage: DECK_LLM_SLIDE_OUTLINE_STAGE,
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
            stage: DECK_LLM_SLIDE_OUTLINE_STAGE,
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
    schemaDescription: 'Deck slide outline object. Root must contain slides only. Every slides[] item must contain goal, informationRole, mustCover, narrationBudgetSeconds, outlineId, sourceSectionIds, templateIntent, and visualIntent. Do not return outline, title, visibleText, points, narration, or slide-plan fields.',
    schemaName: 'LLMTextDeckSlideOutline',
    stage: DECK_LLM_SLIDE_OUTLINE_STAGE,
    temperature: 0.2,
  })
}

function createSlideOutlineOutputContract() {
  return {
    forbiddenRootFieldNames: ['outline', 'slideOutline', 'slidePlan', 'slidesPlan'],
    root: {
      required: ['slides'],
    },
    slide: {
      forbiddenFieldNames: ['narration', 'points', 'slideId', 'slideNumber', 'speakerNote', 'title', 'visibleText'],
      required: ['goal', 'informationRole', 'mustCover', 'narrationBudgetSeconds', 'outlineId', 'sourceSectionIds', 'templateIntent', 'visualIntent'],
    },
    slideShape: {
      goal: 'non-empty string describing what this outline slide covers',
      informationRole: 'non-empty short semantic role label for this outline slide',
      mustCover: 'boolean copied from whether the covered source section is required',
      narrationBudgetSeconds: 'positive number pacing weight',
      outlineId: 'stable non-empty id such as outline-001',
      sourceSectionIds: ['array of one or more analysis section ids; preserve ids exactly'],
      templateIntent: 'one registered template type from target.templateManifest.templates[].type',
      visualIntent: 'non-empty description of visual job; no CSS, fonts, or coordinates',
    },
  }
}

export function createSlidePlanRequest(
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
): GenerateObjectRequest<LLMTextDeckSlidePlanGeneration> {
  const baseMessage: LLMMessage = {
    content: JSON.stringify({
      analysis,
      brief,
      goal: 'Turn the approved slide outline into PPT-style slide data. Return slide structure, visible text, template data, visuals, motion, and transitions only.',
      instructions: [
        'Return exactly one slide-plan slide for each slideOutline.slides item, preserving outlineId and sourceSectionIds as sectionIds.',
        'Use requiredSlides as the binding checklist: return exactly one slides[] entry for every requiredSlides item, preserving outlineId values and slide order.',
        'Use slideOutline.templateIntent as the default slide type unless the template manifest makes a different controlled template clearly better.',
        'Use target.contentDensity.visibleTextPolicy to choose how much visible detail to include, while respecting every template field limit and target.maxSlideCharacters. target.maxSlideCharacters and target.maxVisibleCharactersPerSlide are the same slide-level visible-text budget.',
        'For title and subtitle fields, respect templateManifest.limits.title_chars and subtitle_chars. Keep titles short; move explanatory wording into subtitle, points, process.steps, or code.text when the title limit is tight.',
        'For point-like fields controlled by templateManifest.limits.point_chars, keep each point, comparison point, and chart label comfortably below the limit when possible: for a 40-character limit, aim for 36 characters or fewer. If required detail cannot fit, switch to code.text or process.steps instead of writing long point sentences.',
        'Choose slide type only from target.templateManifest.templates. Do not invent, rename, or translate type values.',
        'For visual.kind, choose one of chart, code, process, table, text, or title-card. Return assetRefs as an empty array.',
        'When target.requiredSlideTypes is provided, include every listed slide type at least once.',
        'Required code slides must include a non-empty code field, and required process slides must use the process type with concrete process.steps.',
        'For process slides, fill process.steps with 2-7 ordered steps. Use label for the step name and detail for observable inputs, metrics, thresholds, decision branches, examples, or falsification criteria. points may stay empty or hold only a short slide-level summary.',
        'For workflow, validation-chain, checklist, scoring, sizing, or quality-control process slides, every process.steps[].detail must be an executable visible instruction or verification criterion. Do not use a category label, "A vs. B" contrast, or generic phrase as the whole detail.',
        'Preserve the slideOutline slide count exactly. If content cannot fit a template, validation will route the fix back to slide-outline rather than asking this stage to invent extra slides.',
        'If content exceeds a template limit, select a better registered template or keep only source-critical visible text; do not add slides in this stage.',
        'Do not put multiple unrelated themes on one slide; split by topic before choosing a template.',
        'For workflow, checklist, validation, scoring, risk, sizing, and output-template slides, visible fields must carry the operational method: concrete observable inputs, metrics, thresholds, decision branches, examples, or falsification conditions from the source.',
        'Do not hide practical detail only in speakerNote or semantic metadata. If a viewer needs the detail to apply the method, put it in points, process.steps, comparison, chart, stat, code.text, or another visible structured field.',
        'For dense ordered checklists, schemas, report structures, and output templates with more items than points or process.steps can hold, use the code template with code.language "text" and code.text as short newline-separated lines; keep points empty or as a short summary.',
        'Dense output-template code.text must fit target.maxSlideCharacters together with title and points: use terse "Field: fill rule" lines, keep points empty or one short caption, and avoid parenthetical examples on every line.',
        'Every generated visible text field except code.text must be clean single-line text: no leading/trailing whitespace, repeated spaces, tabs, newlines, Markdown bullets, tables, headings, blockquotes, fences, or page-number prefixes.',
        'For structured templates, type and template data must match outputContract.structuredTemplateData exactly: keep the type and fill the required object fields, or choose another registered template and omit that structured object.',
        'For verification-chain slides, include visible checkpoints such as revenue/guidance, backlog/orders, margin/mix, utilization/capacity, management commentary, and at least one confirm/weaken/falsify condition when the source supports it.',
        'For scoring slides, visible fields must show how to assign scores: include the scale meaning such as 1=weak/5=strong when the source uses a 1-5 scale, the concrete scoring dimensions, and how score bands change priority or next action.',
        'For position-sizing slides, show the visible mapping from evidence state or score band to next action; do not only say "score" or "conditional sizing".',
        'For output-template slides, replace placeholders with short filled examples or field-specific instructions so the viewer can see what each report section should contain, but prefer short field rules over examples when many sections must fit.',
        'For output-template code slides, code.text must not be a headings-only outline. Use compact lines such as "Section: fill rule" when the full template is too long.',
        'For output-structure or output-template code slides, placeholder text such as Company / ticker, X/Y/Z, A/B/C, or "..." must include the source-required filling rule on the same visible line, including what to do when no candidate or multiple candidates exist.',
        'When the source contains code fences, shell commands, configuration snippets, API examples, or code_sample references, include at least one code slide that preserves a short representative snippet in code.text.',
        'For code slides, remove Markdown fences and raw template markers from visible text, but preserve the executable command, configuration, request, response, or schema content needed by the viewer.',
        'For explainer decks with more than three slides, end with a summary slide that restates the main takeaways and next practical action.',
        'Only use comparison, stat, chart, quote, or code when the matching structured field is complete.',
        'Return transitionOut for every slide. For the final slide, set transitionOut to null.',
        'For transitionOut.type use only crossfade, fade, slide-left, or slide-up. Do not use motion preset names such as fade-in, blur-rise, zoom-focus, or cinematic-rise as transition types; use fade when you want a fade transition.',
        'Choose motion only from controlled presets; do not describe CSS, colors, fonts, or absolute positions.',
        'Follow outputContract exactly. Return slide-plan fields only; do not return outline, narration, or script metadata.',
      ],
      inputPath,
      outputContract: createSlidePlanOutputContract(),
      requiredSlides: createSlidePlanRequiredSlides(slideOutline),
      slideOutline,
      stage: DECK_LLM_SLIDE_PLAN_STAGE,
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
            stage: DECK_LLM_SLIDE_PLAN_STAGE,
          }),
          role: 'assistant' as const,
        },
        {
          content: JSON.stringify({
            attemptsRemaining: rewrite.attemptsRemaining,
            goal: 'Rewrite the slide-plan stage output so it satisfies the structured validation issues. Return a complete replacement slide-plan object, not a patch.',
            instructions: [
              'Return only the replacement slide-plan object at the JSON root with slides, targetPlatform, theme, and title.',
              'Do not wrap the response in invalidOutput, issues, feedback, repair, result, output, or any other envelope, and do not echo the validation feedback payload.',
              'Use issues as binding field-level feedback.',
              'Resolve every issue in the issues array before returning; do not stop after fixing only the first issue.',
              'If an issue includes repairStrategy, requiredAdditions, forbiddenFixes, repeatCount, or escalationReason, treat those fields as binding repair contract. Address each requiredAdditions item directly and avoid every forbiddenFixes item.',
              'Before returning, count every generated title, subtitle, point, process step label/detail, comparison point, chart label, quote.text, and code.text with JavaScript string length semantics; ensure each field fits its listed issue.limit/templateManifest limit and each slide stays within target.maxSlideCharacters.',
              'For title/subtitle limit repairs, shorten the title or subtitle itself; move extra explanatory words into a visible structured field that has enough capacity.',
              'For point-like fields with a 40-character template limit, aim for 36 characters or fewer unless issue.limit explicitly requires a different smaller limit; if a practical detail cannot fit in a point, move that detail into code.text or process.steps.',
              'Only change slide structure, visible text, template data, visual kind, motion, theme, platform, and transition choices needed to satisfy the issues.',
              'For LOW_INFORMATION_DEPTH and MISSING_PRACTICAL_DETAIL issues, repair the visible slide-plan fields directly. Do not rely on speakerNote, scriptSemantics, semantic metadata, or later narration to carry the missing operational detail.',
              'For scoring-detail repairs, the returned visible fields must include the score scale meaning, named dimensions, and a score-band or evidence-state mapping to priority, watchlist, small test, add, reduce, or exit.',
              'For process-slide practical-detail repairs, rewrite process.steps[].detail itself with the missing question, observable input, metric, example, or confirm/weaken/falsify condition named by the issue; do not only rename labels or switch templates.',
              'For output-template practical-detail repairs, rewrite code.text so each section has the section name plus a short field-specific instruction, filled example, required input, or validation condition; a headings-only code block is still invalid.',
              'For dense output-template repairs, keep the whole slide under target.maxSlideCharacters by using terse "Field: fill rule" lines, removing parenthetical examples first, and keeping points empty or one short caption.',
              'For placeholder-detail repairs, rewrite each placeholder line with the missing filling rule from the source; do not leave Company / ticker, X/Y/Z, A/B/C, "...", or "原因是..." as standalone visible content.',
              'If points cannot hold the needed detail, switch to a registered structured template and fill its visible structured data completely. Use code.text for dense ordered lists, schemas, report structures, or output templates; use process.steps only when the full visible sequence fits process step limits.',
              'For TEMPLATE_TEXT_LENGTH_LIMIT repairs, rewrite the exact issue.path field below issue.limit and scan sibling point-like fields on the same slide for the same limit before returning. For quote.text, keep a compact source-grounded excerpt or switch away from quote when the required idea cannot fit quote_chars. Use compact formulas or switch to code.text/process.steps when a full example sentence cannot fit the current point limit.',
              'For TEXT_CLEANLINESS repairs, rewrite the exact field with normal single spaces only. If repeated spacing was separating multiple items, split those items into points, process.steps, comparison, or code.text instead of preserving the spacing.',
              'When attemptsRemaining is 0, also scan all workflow, validation, scoring, sizing, quality, and output-template slides for the same missing-practical-detail pattern and fix them proactively before returning.',
              'For transitionOut.type fixes, use only crossfade, fade, slide-left, or slide-up. Replace fade-in or fade-out transition values with fade.',
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
    schemaDescription: `Deck slide plan object. Root must contain slides, targetPlatform, theme, and title. Every slides[] item must contain durationIntent, motion, outlineId, points, sectionIds, title, transitionOut, type, and visual. Structured templates require matching data objects: ${formatStructuredTemplateDataRequirements()}. transitionOut.type must be one of crossfade, fade, slide-left, or slide-up; fade-in is not valid there. Do not return speakerNote, narration, outline, semantic, or sourceRange in this stage.`,
    schemaName: 'LLMTextDeckSlidePlan',
    stage: DECK_LLM_SLIDE_PLAN_STAGE,
    temperature: 0.2,
  })
}

function createSlidePlanOutputContract() {
  return {
    forbiddenRootFieldNames: ['outline', 'script', 'scriptSemantics'],
    root: {
      required: ['slides', 'targetPlatform', 'theme', 'title'],
    },
    slide: {
      forbiddenFieldNames: ['narration', 'semantic', 'slideIndex', 'sourceRange', 'speakerNote'],
      required: ['durationIntent', 'motion', 'outlineId', 'points', 'sectionIds', 'title', 'transitionOut', 'type', 'visual'],
    },
    slideShape: {
      durationIntent: 'positive number',
      motion: 'one controlled motion preset',
      outlineId: 'copy exactly from slideOutline.slides[].outlineId',
      points: ['array of visible point strings; use [] only when structured fields carry the visible content'],
      sectionIds: ['array of one or more source section ids'],
      title: 'non-empty visible slide title',
      transitionOut: 'object with positive duration and type one of crossfade, fade, slide-left, slide-up; use null for final slide; do not use fade-in',
      type: 'one registered template type',
      visual: {assetRefs: [], kind: 'one of chart, code, process, table, text, title-card'},
    },
    structuredTemplateData: createStructuredTemplateDataOutputContract(),
  }
}

function createStructuredTemplateDataOutputContract() {
  return LLM_DECK_STRUCTURED_TEMPLATE_DATA_REQUIREMENTS.map((requirement) => ({
    rule: `When slides[].type is "${requirement.type}", slides[].${requirement.field} is required; when type is not "${requirement.type}", slides[].${requirement.field} is forbidden.`,
    requiredFields: [...requirement.requiredFields],
    structuredField: requirement.field,
    type: requirement.type,
  }))
}

function formatStructuredTemplateDataRequirements(): string {
  return LLM_DECK_STRUCTURED_TEMPLATE_DATA_REQUIREMENTS
    .map((requirement) => `${requirement.type}=>${requirement.field}(${requirement.requiredFields.join(', ')})`)
    .join('; ')
}

function createExactSlidePlanSchema(slideOutline: LLMTextDeckSlideOutline) {
  return LLMTextDeckSlidePlanGenerationSchema.extend({
    slides: LLMTextDeckSlidePlanGenerationSchema.shape.slides.length(slideOutline.slides.length),
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

export function createScriptSemanticsRequest(
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
): GenerateObjectRequest<LLMTextDeckScriptSemanticsGeneration> {
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
        'Every slide must have non-empty semantic.sourceQuoteText, including summary, recap, and output-template slides; use the source passage that supports the summarized workflow or template.',
        'Keep semantic.blockText, semantic.momentReason, semantic.momentSummary, semantic.visualStyle, and semantic.claim.text as single-line text with no newlines, tabs, Markdown bullets, table pipes, or repeated spaces.',
        'semantic.sourceQuoteText is evidence, not visible text: keep it non-empty and source-grounded, and preserve source Markdown/table/code syntax when it is the most relevant evidence.',
        'When source transcript segments are available, choose sourceRange from timed transcript evidence.',
        'For markdown or text sources, sourceRange is the planned presentation timeline range in seconds, not a source character offset. When requiredSlides[].sourceRangeHint is present, copy its range exactly into slides[].sourceRange.',
        'Never return a placeholder or zero-length sourceRange such as [0,0]; sourceRange must always have end greater than start.',
        'Return outline with exactly one section per slide in slide order.',
        'Copy scriptOutlineObject exactly into the root outline field.',
        'Root outline must be an object with sections: [{goal, title}]. Do not copy slideOutline.slides into outline, and do not return outline as an array.',
        'Root slides must be script-semantics slides with duration, semantic, slideIndex, sourceRange, and speakerNote. Do not return slideOutline or slidePlan slide fields such as outlineId, sourceSectionIds, goal, informationRole, narrationBudgetSeconds, templateIntent, visualIntent, points, title, type, or visual.',
        'Follow outputContract exactly. Return script-semantics fields only; do not return slide-plan visible fields as the root object.',
      ],
      inputPath,
      outputContract: createScriptSemanticsOutputContract(),
      requiredSlides: createScriptSemanticsRequiredSlides(slideOutline, slidePlan, options),
      scriptOutlineObject: createScriptOutlineObject(slideOutline, slidePlan),
      scriptTimingBudgets: createScriptTimingBudgets(slideOutline, slidePlan, options),
      slidePlan,
      source: {
        durationSeconds: options.durationTargetSeconds,
        sourceType: requireDeckPlanningSourceType(options.sourceType),
      },
      stage: DECK_LLM_SCRIPT_SEMANTICS_STAGE,
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
            stage: DECK_LLM_SCRIPT_SEMANTICS_STAGE,
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
    schemaDescription: 'Deck script semantics object. Root must contain outline and slides. outline must be an object with outline.sections[].goal and outline.sections[].title, not an array. Every slides[] item must contain duration, semantic, slideIndex, sourceRange, and speakerNote. semantic must contain blockText, blockType, claim, momentReason, momentScore, momentSummary, sourceQuoteText, and visualStyle.',
    schemaName: 'LLMTextDeckScriptSemantics',
    stage: DECK_LLM_SCRIPT_SEMANTICS_STAGE,
    temperature: 0.2,
  })
}

function createScriptSemanticsOutputContract() {
  return {
    forbiddenRootFieldNames: ['slideOutline', 'slidePlan', 'script', 'storyboard'],
    outline: {
      forbiddenShape: 'array; slideOutline.slides entries; slide-plan entries',
      required: ['sections'],
    },
    outlineSection: {
      forbiddenFieldNames: ['informationRole', 'mustCover', 'narrationBudgetSeconds', 'outlineId', 'sourceSectionIds', 'templateIntent', 'visualIntent'],
      required: ['goal', 'title'],
    },
    outlineShape: {
      sections: [{
        goal: 'non-empty string summarizing the script section goal for this slide',
        title: 'non-empty section title for this slide',
      }],
      source: 'copy scriptOutlineObject exactly into root outline',
    },
    root: {
      required: ['outline', 'slides'],
    },
    slide: {
      forbiddenFieldNames: ['durationIntent', 'goal', 'informationRole', 'motion', 'mustCover', 'narrationBudgetSeconds', 'outlineId', 'points', 'sectionIds', 'sourceSectionIds', 'templateIntent', 'title', 'transitionOut', 'type', 'visual', 'visualIntent'],
      required: ['duration', 'semantic', 'slideIndex', 'sourceRange', 'speakerNote'],
    },
    slideShape: {
      duration: 'positive expected spoken duration in seconds',
      semantic: 'object with semantic narration metadata, not a slide outline item',
      slideIndex: 'zero-based integer matching requiredSlides[].slideIndex',
      sourceRange: '[startSeconds, endSeconds] copied from requiredSlides[].sourceRangeHint.range when provided',
      speakerNote: 'non-empty natural narration for this slide',
    },
    semantic: {
      required: ['blockText', 'blockType', 'claim', 'momentReason', 'momentScore', 'momentSummary', 'sourceQuoteText', 'visualStyle'],
    },
    semanticShape: {
      sourceQuoteText: 'non-empty source-backed evidence text for this slide; use a source excerpt or faithful paraphrase, never blank, N/A, none, or a placeholder',
    },
    semanticClaimShape: {
      claim: 'object with confidence, text, and type, or null when the slide carries no claim artifact',
      sourceRange: '[startSeconds, endSeconds] with end greater than start',
    },
  }
}

function createScriptOutlineObject(
  slideOutline: LLMTextDeckSlideOutline,
  slidePlan: LLMTextDeckSlidePlan,
): LLMTextDeckScriptSemantics['outline'] {
  return {
    sections: slidePlan.slides.map((slide, index) => {
      const outlineSlide = requireScriptOutlineSlide(slideOutline, index)

      return {
        goal: outlineSlide.goal,
        title: slide.title,
      }
    }),
  }
}

function createExactScriptSemanticsSchema(slidePlan: LLMTextDeckSlidePlan) {
  return LLMTextDeckScriptSemanticsGenerationSchema.extend({
    slides: LLMTextDeckScriptSemanticsGenerationSchema.shape.slides.length(slidePlan.slides.length),
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
    const outlineSlide = requireScriptOutlineSlide(slideOutline, index)
    const sourceSectionIds = uniqueStrings([
      ...slide.sectionIds,
      ...outlineSlide.sourceSectionIds,
    ])
    const sourceRangeHint = requireScriptTimelineRangeHint(rangeHints, index)

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
    const outlineSlide = requireScriptOutlineSlide(slideOutline, index)

    return requireScriptTimelineSeconds(outlineSlide.narrationBudgetSeconds, `Deck script timeline narration budget for slide ${index + 1}`)
  })

  if (rawDurations.length === 0) {
    throw new Error('Deck script timeline requires at least one slide; no synthetic one-slide timeline fallback is allowed.')
  }

  const rawTotal = rawDurations.reduce((sum, duration) => sum + duration, 0)
  const targetTotal = options.durationTargetSeconds === undefined
    ? rawTotal
    : requireScriptTimelineSeconds(options.durationTargetSeconds, 'Deck script timeline target duration')
  const scale = targetTotal / rawTotal
  let cursor = 0

  return rawDurations.map((duration, index) => {
    const start = roundTimelineSeconds(cursor)
    cursor += duration * scale
    const isLast = index === rawDurations.length - 1
    const end = roundTimelineSeconds(isLast ? targetTotal : cursor)

    return {
      basis: 'planned-presentation-timeline',
      range: requirePositiveRoundedTimelineRange(start, end, index),
      unit: 'seconds',
    }
  })
}

function requireScriptOutlineSlide(slideOutline: LLMTextDeckSlideOutline, index: number): LLMTextDeckSlideOutline['slides'][number] {
  const outlineSlide = slideOutline.slides[index]

  if (outlineSlide === undefined) {
    throw new Error(`Deck script semantics request requires slideOutline slide ${index + 1}; no slide-plan duration fallback is allowed.`)
  }

  return outlineSlide
}

function requireScriptTimelineRangeHint(
  rangeHints: Array<{basis: 'planned-presentation-timeline'; range: [number, number]; unit: 'seconds'}>,
  index: number,
): {basis: 'planned-presentation-timeline'; range: [number, number]; unit: 'seconds'} {
  const rangeHint = rangeHints[index]

  if (rangeHint === undefined) {
    throw new Error(`Deck script semantics request requires timeline range hint ${index + 1}; no positional range fallback is allowed.`)
  }

  return rangeHint
}

function requireScriptTimelineSeconds(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number; no epsilon timeline fallback is allowed. Received: ${String(value)}`)
  }

  return value
}

function requirePositiveRoundedTimelineRange(start: number, end: number, index: number): [number, number] {
  if (end <= start) {
    throw new RangeError(`Deck script timeline range for slide ${index + 1} collapsed after millisecond rounding; no epsilon timeline fallback is allowed.`)
  }

  return [start, end]
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
    const outlineSlide = requireScriptOutlineSlide(slideOutline, index)
    const budgetSeconds = requireScriptTimelineSeconds(outlineSlide.narrationBudgetSeconds, `Deck script timing budget for slide ${index + 1}`)

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

export function createCoherenceReviewRequest(
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
        'When judging slide-plan practical detail, inspect slidePlan visible fields directly. Do not report a slide-plan issue merely because scriptSemantics speakerNote or semantic metadata summarizes details that are already visible in points, process.steps, chart, timeline, or code.text.',
        'If narration or semantic metadata fails to cover visible details that are already present, report a script-semantics issue at speakerNote or semantic path instead of asking slide-plan to rewrite visible text again.',
        'For process slides, review process.steps as the visible flowchart content. process.steps[].label and process.steps[].detail are both rendered visibly; do not treat empty points as a defect when process.steps carries concrete ordered labels and details.',
        'Do not require process.steps on non-process slide types. For non-process slides, judge the rendered visible fields for that template, such as points, quote.text, code.text, comparison, chart, or stat. If those fields cannot carry source-required practical detail, request a slide-plan template replan with a registered higher-capacity template instead of claiming process.steps is empty.',
        'Treat process.steps[].detail as insufficient when it only names a topic or contrast; for workflow and validation slides it must include the question to ask, observable evidence to inspect, or confirm/weaken/falsify condition.',
        'For scoring slides, consider the visible text sufficient only when it includes the scoring scale meaning, named dimensions, and the decision or priority mapping produced by the score.',
        'For output-template code slides, report MISSING_PRACTICAL_DETAIL when code.text only lists section headings without field-specific instructions, examples, required inputs, or validation conditions.',
        'For output-structure or template code slides, report LOW_INFORMATION_DEPTH when placeholder lines such as Company / ticker, X/Y/Z, A/B/C, or "..." are not paired with source-required filling rules or no-candidate/multiple-candidate handling.',
        'Report LOW_INFORMATION_DEPTH or MISSING_PRACTICAL_DETAIL as severity error when the issue affects a must-cover section, workflow step sequence, output template, code/config example, validation criterion, or required caveat.',
        'Check timing realism at deck level: total slide durations and total estimated speakerNote duration should be close to target.durationSeconds. Per-slide budget mismatches are warnings unless they break narrative comprehension.',
        'Do not force every speakerNote to fit its outline narrationBudgetSeconds. Prefer aggregate pacing: dense slides may be longer when simple slides are shorter.',
        'Check template variety: do not use repeated one-big-idea/summary cards when process, table, code, comparison, stat, quote, or chart would make the source structure clearer.',
        'For each issue choose the earliest responsible stage: slide-outline for coverage/order/budget/template intent, slide-plan for visible text/template choice, script-semantics for narration/duration/semantic metadata.',
        'Use severity error only when rewrite is required before artifact build; use warning for reviewable quality concerns.',
        'Follow outputContract exactly. Return only issues and summary at the JSON root.',
      ],
      inputPath,
      outputContract: createCoherenceReviewOutputContract(),
      previousIssues,
      scriptSemantics,
      slideOutline,
      slidePlan,
      stage: DECK_LLM_COHERENCE_REVIEW_STAGE,
      target: createDeckPlanningTarget(options, {includeTemplateManifest: true}),
    }),
    role: 'user',
  }

  return createDeckObjectPromptRequest({
    buildMessages: () => [baseMessage],
    id: 'deck.coherence-review',
    promptInput: {analysis, brief, inputPath, options, previousIssues, scriptSemantics, slideOutline, slidePlan},
    schema: LLMTextDeckCoherenceReviewSchema,
    schemaDescription: 'Deck coherence review object. Root must contain issues and summary only. issues must be an array of objects with code, message, severity, and stage, plus optional path or slideIndex.',
    schemaName: 'LLMTextDeckCoherenceReview',
    stage: DECK_LLM_COHERENCE_REVIEW_STAGE,
    temperature: 0.1,
  })
}

function createCoherenceReviewOutputContract() {
  return {
    forbiddenRootFieldNames: ['analysis', 'report', 'review'],
    issue: {
      optional: ['path', 'slideIndex'],
      required: ['code', 'message', 'severity', 'stage'],
    },
    root: {
      required: ['issues', 'summary'],
    },
  }
}
