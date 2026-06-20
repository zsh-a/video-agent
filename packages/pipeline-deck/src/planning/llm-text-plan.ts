import type {GenerateObjectRequest, LLMClient, LLMMessage} from '@video-agent/llm'

import {deckTemplateManifestForLLM} from '@video-agent/renderer-deck'

import {LLM_TEXT_DECK_MAX_SLIDES, LLMTextDeckPlanSchema, type LLMTextDeckPlan} from './llm-plan.js'
import type {TextDeckProjectPlan, TextDeckProjectPlanOptions} from './types.js'
import {DECK_THEME_DESCRIPTIONS} from './utils.js'
import {createTextDeckProjectPlanFromLLM} from './text-plan-builder.js'

const DECK_LLM_SOURCE_TEXT_MAX_CHARACTERS = 60_000
const DECK_LLM_TRANSCRIPT_SEGMENT_LIMIT = 500
const DECK_LLM_TRANSCRIPT_SEGMENT_TEXT_MAX_CHARACTERS = 500
const DECK_LLM_VALIDATION_REWRITE_ATTEMPTS = 3

export async function createLLMTextDeckProjectPlan(
  llm: LLMClient,
  inputPath: string,
  text: string,
  options: TextDeckProjectPlanOptions,
): Promise<TextDeckProjectPlan> {
  const sourceText = requireDeckLLMSourceText(text)
  const planOptions = {...options}
  const initialRequest = createDeckPlanningRequest(inputPath, sourceText, planOptions)
  const result = await llm.generateObject(initialRequest)

  try {
    return createTextDeckProjectPlanFromLLM(inputPath, text, result.object, planOptions)
  } catch (error) {
    return rewriteInvalidDeckPlan(llm, {
      error,
      initialRequest,
      inputPath,
      options: planOptions,
      rawPlan: result.object,
      text,
    })
  }
}

function createDeckPlanningRequest(inputPath: string, sourceText: string, options: TextDeckProjectPlanOptions): GenerateObjectRequest<LLMTextDeckPlan> {
  return {
    messages: [createDeckPlanningMessage(inputPath, sourceText, options)],
    schema: LLMTextDeckPlanSchema,
    temperature: 0.2,
  }
}

function createDeckPlanningMessage(inputPath: string, sourceText: string, options: TextDeckProjectPlanOptions): LLMMessage {
  return {
    content: JSON.stringify({
      goal: 'Turn the source Markdown/text into a concise PPT-style explainer deck. Return only clean semantic slide data matching the schema.',
      instructions: [
        'Return the final output language explicitly in the language field. If target.language is auto, choose the strongest source/user language from the input instead of defaulting.',
        'Return targetPlatform explicitly from the intended distribution platform or source context. Use generic only when no specific platform is requested or evident.',
        'Use the final output language for all visible text and speaker notes.',
        'Remove YAML frontmatter, Markdown syntax, code fences, table pipes, raw template markers, and implementation-only metadata.',
        'Do not split sentences by character count. Merge related source sections into audience-facing ideas.',
        'If the source is an agent skill or internal instruction document, explain what it does, when to use it, the workflow, output shape, and quality bar.',
        'Infer source structure, coverage, and section importance from the full source text. Every major source idea should appear as a slide topic, visible point, or concrete speakerNote detail unless it is pure metadata.',
        'For structured method documents, preserve optional helper/data sections, answer shape, output template, quality bar, validation criteria, and caveats as first-class content instead of collapsing everything into generic workflow steps.',
        'Do not paste the raw source verbatim. Rewrite it into natural presentation language.',
        'When translating, preserve the source-domain meaning of technical terms and object nouns. Do not substitute terms from unrelated domains unless the source uses them.',
        'Keep slide titles short and concrete.',
        'Use concise visible text and respect each template field and limit in target.templateManifest.',
        'Choose slide type only from target.templateManifest.templates. Do not invent, rename, or translate type values.',
        'Every slide must include duration, visual, transitionOut, speakerNote, and semantic metadata. Do not rely on the runtime to infer narration timing, visual kind, block types, claims, quotes, selected moments, storyboard style, outline sections, or slide transitions.',
        'Return outline explicitly with exactly one outline section per slide, in slide order. Each section title and goal must be authored for the outline, not copied blindly from slide title or speakerNote.',
        'Return transitionOut explicitly for every slide. For every non-final slide, choose type crossfade, fade, slide-left, or slide-up plus a positive duration in seconds based on narrative rhythm. For the final slide, set transitionOut to null.',
        'When source.transcriptSegments is provided, choose each slide sourceRange from the timed transcript evidence. The range must cover the transcript moments that support that slide and stay within source.durationSeconds.',
        'When source.transcriptSegments is not provided, still return an LLM-authored sourceRange for every slide using the intended presentation timeline. Do not rely on runtime proportional timing to synthesize selected moments or storyboard ranges.',
        'When target.requiresSlideSourceRanges is true, every slide must include sourceRange as [startSeconds, endSeconds]. Do not rely on runtime proportional timing or fixed slide durations for source attribution or audio alignment.',
        'For visual.kind, choose one of chart, code, process, table, text, or title-card. Do not choose image or diagram because the current Deck renderer cannot consume visual prompts or assetRefs; express the visual intent through the slide template data instead. Return assetRefs explicitly as an empty array unless the renderer has concrete support for that asset.',
        'For semantic.blockType, choose the best document block role from claim, context, data, example, quote, recommendation, or summary.',
        'Always return semantic.claim explicitly. Use an object with type claim, data, recommendation, or summary plus text and confidence when the slide should create a claim artifact; use null only when the slide should not create a claim artifact.',
        'For semantic.claim.confidence and semantic.momentScore, return calibrated numbers from 0 to 1 based on source support and narrative importance.',
        'For semantic.blockText and semantic.claim.text, write concise audience-facing propositions grounded in the source. For semantic.sourceQuoteText, choose or paraphrase the most relevant source-backed evidence for the slide.',
        'For semantic.momentSummary and semantic.momentReason, describe why this slide is a meaningful selected moment in the deck. For semantic.visualStyle, name the intended slide visual style in a short stable phrase.',
        'When target.requiredSlideTypes is provided, include every listed slide type at least once. Required code slides must include a non-empty code field, and required process slides must use the process type with concrete ordered points.',
        'Choose the slide count from the source complexity, required slide types, template limits, and target duration. Do not follow a runtime-estimated fixed slide count.',
        'If content exceeds a template limit, split it into multiple slides instead of overfilling one slide.',
        'Do not put multiple unrelated themes on one slide; split by topic before choosing a template.',
        'When the source contains code fences, shell commands, configuration snippets, API examples, or code_sample references, include at least one code slide that preserves a short representative snippet in code.text.',
        'For code slides, remove Markdown fences and raw template markers from visible text, but preserve the executable command, configuration, request, response, or schema content that the viewer needs to understand.',
        'For explainer decks with more than three slides, end with a summary slide that restates the main takeaways and the next practical action. Do not use comparison, process, timeline, or one-big-idea as the final slide when the summary template is available.',
        'Only use comparison when the comparison field has left and right labels plus 2-3 concrete points on each side. Otherwise use three-points or one-big-idea.',
        'Only use stat when the stat field contains a meaningful value, label, and supporting caption or points. Avoid decorative single-number slides.',
        'Only use chart when the chart field contains 2-4 bars with concise labels and normalized value numbers from 0 to 1. Do not rely on runtime-generated chart values.',
        'For one-big-idea and cta slides, the primary idea or action must be in points[0]. Do not rely on subtitle as a replacement for the required visible point.',
        'For process or timeline slides, include every major step needed to make the title true. Do not title a slide "seven steps" unless the visible points contain all seven steps.',
        'When explaining a method or framework, include at least one concrete application example, evidence workflow, validation path, or output shape unless the source forbids examples.',
        'For finance or research frameworks, preserve evidence sources, validation or kill criteria, freshness caveats, and non-advice disclaimers when present.',
        'Choose motion only from controlled presets; do not describe CSS, colors, fonts, or absolute positions.',
        'Write one natural speakerNote per slide for TTS. It should sound like a presenter guiding the viewer through the slide, not a file reader.',
        'The speakerNote MUST walk the viewer through the on-screen content in order. Expand each visible point into a natural spoken sentence. Do not skip any point.',
        'Match the speakerNote specificity to the on-screen content. If a point shows a formula, mention the formula. If a point lists specific items, name the key ones. Do not summarize vaguely when the screen shows concrete details.',
        'Do not introduce new arguments, examples, claims, or steps that are not visible on the current slide, except for brief transition phrases that reference the previous or next slide topic.',
        'For comparison slides, describe both sides. For code slides, briefly explain each visible section. For stat, quote, and chart slides, explicitly mention the displayed value, quote, or chart takeaway.',
        'Add brief transitions between slides: start each speakerNote except the first by connecting to the previous slide, and end each speakerNote except the last with a short phrase previewing the next slide. Keep each transition to one short clause.',
        'The speakerNote must not claim a specific number of steps, phases, reasons, metrics, scenarios, or criteria unless the visible content contains that exact number. If the slide shows 4 points, say "the key steps" or "four main steps", not "seven steps".',
        'Avoid page-number prefixes such as "第 1 页" in speakerNote.',
        'Return duration as the intended positive slide narration duration in seconds. Choose each speakerNote length from the visible content, source importance, and target duration instead of a fixed character budget.',
        'Choose the most appropriate visual theme from the available themes based on the content topic and tone. Return the theme name in the "theme" field.',
      ],
      source: {
        durationSeconds: options.durationTargetSeconds,
        path: inputPath,
        sourceType: requireDeckPlanningSourceType(options.sourceType),
        text: sourceText,
        transcriptSegments: options.transcriptSegments === undefined ? undefined : summarizeTranscriptSegments(options.transcriptSegments),
      },
      target: createDeckPlanningTarget(options),
    }),
    role: 'user',
  }
}

function requireDeckPlanningSourceType(sourceType: TextDeckProjectPlanOptions['sourceType']): NonNullable<TextDeckProjectPlanOptions['sourceType']> {
  if (sourceType === undefined) {
    throw new Error('Deck LLM planning requires an explicit sourceType before request construction; no request-time sourceType fallback is allowed.')
  }

  return sourceType
}

async function rewriteInvalidDeckPlan(
  llm: LLMClient,
  input: {
    error: unknown
    initialRequest: GenerateObjectRequest<LLMTextDeckPlan>
    inputPath: string
    options: TextDeckProjectPlanOptions
    rawPlan: LLMTextDeckPlan
    text: string
  },
): Promise<TextDeckProjectPlan> {
  const originalValidationError = formatErrorMessage(input.error)

  return attemptDeckPlanRewrite(llm, input, {
    attempt: 1,
    lastError: input.error,
    originalValidationError,
    rawPlan: input.rawPlan,
    validationError: originalValidationError,
  })
}

async function attemptDeckPlanRewrite(
  llm: LLMClient,
  input: {
    initialRequest: GenerateObjectRequest<LLMTextDeckPlan>
    inputPath: string
    options: TextDeckProjectPlanOptions
    text: string
  },
  state: {
    attempt: number
    lastError: unknown
    originalValidationError: string
    rawPlan: LLMTextDeckPlan
    validationError: string
  },
): Promise<TextDeckProjectPlan> {
  if (state.attempt > DECK_LLM_VALIDATION_REWRITE_ATTEMPTS) {
    throw new Error(`Deck LLM rewrite failed after ${DECK_LLM_VALIDATION_REWRITE_ATTEMPTS} validation feedback attempt(s): ${state.validationError}. Original validation error: ${state.originalValidationError}`, {
      cause: state.lastError,
    })
  }

  const result = await llm.generateObject({
    messages: createDeckRewriteMessages(input.initialRequest, input.options, {
      attempt: state.attempt,
      attemptsRemaining: DECK_LLM_VALIDATION_REWRITE_ATTEMPTS - state.attempt,
      invalidDeckPlan: state.rawPlan,
      validationError: state.validationError,
    }),
    schema: LLMTextDeckPlanSchema,
    temperature: 0.2,
  })

  try {
    return createTextDeckProjectPlanFromLLM(input.inputPath, input.text, result.object, input.options)
  } catch (rewriteError) {
    return attemptDeckPlanRewrite(llm, input, {
      attempt: state.attempt + 1,
      lastError: rewriteError,
      originalValidationError: state.originalValidationError,
      rawPlan: result.object,
      validationError: formatErrorMessage(rewriteError),
    })
  }
}

function createDeckRewriteMessages(
  initialRequest: GenerateObjectRequest<LLMTextDeckPlan>,
  options: TextDeckProjectPlanOptions,
  rewrite: {
    attempt: number
    attemptsRemaining: number
    invalidDeckPlan: LLMTextDeckPlan
    validationError: string
  },
): LLMMessage[] {
  return [
    ...(initialRequest.messages ?? []),
    {
      content: JSON.stringify({
        attempt: rewrite.attempt,
        invalidDeckPlan: rewrite.invalidDeckPlan,
        validationError: rewrite.validationError,
      }),
      role: 'assistant',
    },
    {
      content: JSON.stringify({
        attemptsRemaining: rewrite.attemptsRemaining,
        goal: 'Rewrite the entire Deck plan so it passes schema, template, visible text, source range, and timing validation. Return a complete replacement object, not a patch.',
        instructions: [
          'Use the validationError as binding feedback.',
          'Do not ask the runtime to clip, shorten, merge, split, infer, or repair any semantic content.',
          'When text exceeds a template or visible-character limit, rewrite it concisely or split the idea into additional valid slides.',
          'Preserve source-grounded meaning, required slide types, language, clean visible text, speakerNote coverage, explicit semantic.claim object-or-null intent, LLM-authored semantic metadata, explicit outline sections, explicit transitionOut values, and explicit sourceRange values.',
          'Return only data matching the schema.',
        ],
        target: createDeckPlanningTarget(options),
        validationError: rewrite.validationError,
      }),
      role: 'user',
    },
  ]
}

function createDeckPlanningTarget(options: TextDeckProjectPlanOptions): object {
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
    templateManifest: deckTemplateManifestForLLM,
  }
}

function requireDeckLLMSourceText(text: string): string {
  if (text.length > DECK_LLM_SOURCE_TEXT_MAX_CHARACTERS) {
    throw new Error(`Deck LLM planning source text has ${text.length} characters, exceeding the single-request limit ${DECK_LLM_SOURCE_TEXT_MAX_CHARACTERS}. Chunked LLM deck planning is required; no silent truncation is allowed.`)
  }

  return text
}

function summarizeTranscriptSegments(segments: NonNullable<TextDeckProjectPlanOptions['transcriptSegments']>): Array<{
  end: number
  index: number
  speaker?: string
  start: number
  text: string
}> {
  if (segments.length > DECK_LLM_TRANSCRIPT_SEGMENT_LIMIT) {
    throw new Error(`Deck LLM planning received ${segments.length} timed transcript segments, exceeding the single-request limit ${DECK_LLM_TRANSCRIPT_SEGMENT_LIMIT}. Chunked LLM deck planning is required; no silent transcript truncation is allowed.`)
  }

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
        throw new Error(`Deck LLM planning transcript segment ${index + 1} has ${text.length} characters, exceeding the per-segment limit ${DECK_LLM_TRANSCRIPT_SEGMENT_TEXT_MAX_CHARACTERS}. Chunked LLM deck planning is required; no silent segment truncation is allowed.`)
      }

      return {
        end: segment.end,
        index: index + 1,
        ...(segment.speaker === undefined ? {} : {speaker: segment.speaker}),
        start: segment.start,
        text,
      }
    })
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
