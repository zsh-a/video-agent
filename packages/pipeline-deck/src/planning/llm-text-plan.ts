import type {LLMClient} from '@video-agent/llm'

import {deckTemplateManifestForLLM} from '@video-agent/renderer-deck'

import {inferDocumentSourceType} from './input.js'
import {LLMTextDeckPlanSchema} from './llm-plan.js'
import type {TextDeckProjectPlan, TextDeckProjectPlanOptions} from './types.js'
import {DECK_THEME_DESCRIPTIONS, createDeckPlanningSourceStructure, estimateNarrationCharactersPerSlide, estimateTextDeckSlideCount, truncateForLLM} from './utils.js'
import {createTextDeckProjectPlanFromLLM} from './text-plan-builder.js'

export async function createLLMTextDeckProjectPlan(
  llm: LLMClient,
  inputPath: string,
  text: string,
  options: TextDeckProjectPlanOptions,
): Promise<TextDeckProjectPlan> {
  const targetSlideCount = estimateTextDeckSlideCount(text, options.durationTargetSeconds)
  const sourceStructure = createDeckPlanningSourceStructure(text)
  const result = await llm.generateObject({
    messages: [
      {
        content: JSON.stringify({
          goal: 'Turn the source Markdown/text into a concise PPT-style explainer deck. Return only clean semantic slide data matching the schema.',
          instructions: [
            'Use the requested output language for all visible text and speaker notes.',
            'Remove YAML frontmatter, Markdown syntax, code fences, table pipes, raw template markers, and implementation-only metadata.',
            'Do not split sentences by character count. Merge related source sections into audience-facing ideas.',
            'If the source is an agent skill or internal instruction document, explain what it does, when to use it, the workflow, output shape, and quality bar.',
            'Treat source.structure.sections as a coverage checklist. Every major source heading should appear as a slide topic, visible point, or concrete speakerNote detail unless it is pure metadata.',
            'For structured method documents, preserve optional helper/data sections, answer shape, output template, quality bar, validation criteria, and caveats as first-class content instead of collapsing everything into generic workflow steps.',
            'Do not paste the raw source verbatim. Rewrite it into natural presentation language.',
            'When translating, preserve the source-domain meaning of technical terms and object nouns. Do not substitute terms from unrelated domains unless the source uses them.',
            'Keep slide titles short and concrete.',
            'Use concise visible text and respect each template field and limit in target.templateManifest.',
            'Choose slide type only from target.templateManifest.templates. Do not invent, rename, or translate type values.',
            'If content exceeds a template limit, split it into multiple slides instead of overfilling one slide.',
            'Do not put multiple unrelated themes on one slide; split by topic before choosing a template.',
            'Only use comparison when the comparison field has left and right labels plus 2-3 concrete points on each side. Otherwise use three-points or one-big-idea.',
            'Only use stat when the stat field contains a meaningful value, label, and supporting caption or points. Avoid decorative single-number slides.',
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
            'Keep speakerNote close to the target narration length unless the slide is an intro or summary.',
            'Choose the most appropriate visual theme from the available themes based on the content topic and tone. Return the theme name in the "theme" field.',
          ],
          source: {
            path: inputPath,
            structure: sourceStructure,
            sourceType: options.sourceType ?? inferDocumentSourceType(inputPath),
            text: truncateForLLM(text, 60_000),
          },
          target: {
            availableThemes: Object.entries(DECK_THEME_DESCRIPTIONS).map(([name, description]) => ({description, name})),
            durationSeconds: options.durationTargetSeconds,
            format: options.deckFormat ?? 'portrait_1080x1920',
            language: options.language,
            maxVisibleCharactersPerSlide: options.maxSlideCharacters,
            requestedTheme: options.theme === undefined || options.theme === 'auto' ? undefined : options.theme,
            requestedTitle: options.title,
            slideCount: targetSlideCount,
            speakerNoteCharactersPerSlide: estimateNarrationCharactersPerSlide(options.durationTargetSeconds, targetSlideCount),
            templateManifest: deckTemplateManifestForLLM,
          },
        }),
        role: 'user',
      },
    ],
    schema: LLMTextDeckPlanSchema,
    temperature: 0.2,
  })

  return createTextDeckProjectPlanFromLLM(inputPath, text, result.object, options)
}
