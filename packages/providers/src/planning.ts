import type {LLMClient} from '@video-agent/llm'

import {RecapScriptSchema, type RecapScript} from '@video-agent/ir'

import type {RecapScriptProviderInput, ScriptProvider, StoryIndexProviderInput, StoryIndexProviderOutput} from './contracts.js'
import {FilmStoryIndexLLMOutputSchema, createStoryIndexOutput, generateValidatedPlanningObject, validateFilmStoryIndexLLMOutput, validateRecapScriptLLMOutput} from './planning-validation.js'
import {createProviderObjectPromptRequest} from './prompt.js'
import {PROVIDER_PROMPT_FILM_RECAP_SCRIPT_STAGE, PROVIDER_PROMPT_FILM_STORY_INDEX_STAGE} from './prompt-stages.js'

export class LLMScriptProvider implements ScriptProvider {
  constructor(private readonly llm: LLMClient) {}

  async createStoryIndex(input: StoryIndexProviderInput): Promise<StoryIndexProviderOutput> {
    return generateValidatedPlanningObject(this.llm, createProviderObjectPromptRequest({
      buildMessages: (promptInput) => [
        {
          content: JSON.stringify({
            asrResult: promptInput.asrResult,
            goal: 'Create Film Recap story-index semantic JSON. Return only data matching the schema.',
            instructions: [
              'Infer narrative beats from the full ASR transcript, visual scene analysis, silence-aware timeline fusion, and neighboring context.',
              'Use the structured VLM actions, characters, emotions, plotClues, and relationships fields as primary visual semantics.',
              'Do not classify beats, characters, relationships, or importance by keyword matching or fixed position heuristics.',
              'Return beats in chronological order with stable ids like beat-001.',
              'Every beat.sourceRange must stay within sourceManifest.duration and should align with the strongest evidence range.',
              'Every beat.type must be one of the allowed schema values and should reflect the narrative function, not just the beat position.',
              'Attach evidence refs from timelineFusion evidence, ASR segments, and VLM analysis whenever they support the beat.',
              'Build characters only from supported ASR/VLM evidence; include aliases and concise evidence-backed descriptions when available.',
              'Every character must include aliases and evidence explicitly. Use an empty aliases array only when no alias is supported.',
            ],
            language: promptInput.language,
            sourceManifest: summarizeFilmSourceManifest(promptInput.sourceManifest),
            timelineFusion: promptInput.timelineFusion,
            vlmAnalysis: promptInput.vlmAnalysis,
          }),
          role: 'user',
        },
      ],
      id: 'film.story-index',
      promptInput: input,
      schema: FilmStoryIndexLLMOutputSchema,
      schemaName: 'FilmStoryIndexLLMOutput',
      stage: PROVIDER_PROMPT_FILM_STORY_INDEX_STAGE,
      temperature: 0.25,
    }), {
      contextLabel: 'Film Recap story-index',
      repairGoal: 'Rewrite the Film Recap story-index semantic JSON so it passes schema and IR validation. Return a complete replacement object, not a patch.',
      repairInstructions: [
        'Use the validationError as binding feedback.',
        'Do not ask the runtime to infer beat ids, beat types, characters, source ranges, summaries, evidence, or character metadata.',
        'Keep all beats source-grounded in ASR/VLM/timelineFusion evidence.',
        'Return beats and characters explicitly; use an empty characters array only when the source evidence supports no characters.',
        'Rewrite all story-index text fields so they are clean single-line LLM output; do not rely on runtime trim or whitespace repair.',
      ],
      validate: (output) => createStoryIndexOutput(input, validateFilmStoryIndexLLMOutput(input, FilmStoryIndexLLMOutputSchema.parse(output))),
    })
  }

  async createRecapScript(input: RecapScriptProviderInput): Promise<RecapScript> {
    return generateValidatedPlanningObject(this.llm, createProviderObjectPromptRequest({
      buildMessages: (promptInput) => [
        {
          content: JSON.stringify({
            goal: 'Write a Film Recap third-person narration script. Return only JSON matching RecapScriptSchema.',
            instructions: [
              'Create exactly one recap script segment for each storyIndex beat unless a beat is unusable; preserve chronological order.',
              'Every segment.targetBeatIds must contain exactly one id: the matching storyIndex beat id for that segment.',
              'Use ASR and VLM evidence to write scene-specific narration. Do not repeat generic phrases across segments.',
              'Do not paste raw dialogue wholesale. Rewrite into concise third-person recap commentary suitable for TTS.',
              'Make narrationText reflect the concrete event in that beat: who acts, what changes, and why it matters.',
              'Set sourceRange to the exact source clip range that should be used for the segment; this is the only semantic clip-selection signal downstream.',
              'Return clipSelectionReason explicitly for each segment, explaining why the selected sourceRange is the best evidence for the recap beat. Do not use generic labels like "script-driven".',
              'Use visualGuidance to explain why that sourceRange visually supports the narration.',
              'Return overlapsSpeech explicitly for each segment based on whether the voiceover should intentionally play over source speech. Use ASR/VLM evidence and recap pacing; do not rely on runtime ASR overlap heuristics.',
              'Return pauseAfterMs explicitly for each segment based on narrative rhythm. Use 0 only when the next narration should start immediately, and use longer pauses only for meaningful beat transitions.',
              'For climax, reversal, or decision beats, include enough ASR/VLM detail to preserve the concrete plot event.',
              'Keep suggestedDuration proportional to beat sourceRange. When targetDurationSeconds is provided, make totalEstimatedDuration close to it; otherwise choose an explicit recap duration yourself and make totalEstimatedDuration equal the sum of segment suggestedDuration values.',
              'Do not invent character names or plot events not supported by storyIndex, asrResult, or vlmAnalysis.',
              'Use the storyIndex.language for hook, narrationText, visualGuidance, and outro.',
              'Return language explicitly; do not rely on schema defaults.',
            ],
            input: summarizeFilmRecapScriptInput(promptInput),
          }),
          role: 'user',
        },
      ],
      id: 'film.recap-script',
      promptInput: input,
      schema: RecapScriptSchema,
      schemaName: 'RecapScript',
      stage: PROVIDER_PROMPT_FILM_RECAP_SCRIPT_STAGE,
      temperature: 0.35,
    }), {
      contextLabel: 'Film Recap script',
      repairGoal: 'Rewrite the Film Recap recap script JSON so it passes schema validation. Return a complete replacement object, not a patch.',
      repairInstructions: [
        'Use the validationError as binding feedback.',
        'Do not ask the runtime to infer targetBeatIds, choose among multiple beat ids, sourceRange, suggestedDuration, clipSelectionReason, overlapsSpeech, pauseAfterMs, visualGuidance, or language.',
        'Keep every segment grounded in storyIndex, asrResult, and vlmAnalysis evidence.',
        'Return explicit segment timing, clip-selection reason, overlapsSpeech decision, and pause timing for every segment.',
        'Rewrite all recap script text fields so they are clean single-line LLM output; do not rely on runtime trim or whitespace repair.',
      ],
      validate: (output) => validateRecapScriptLLMOutput(input, RecapScriptSchema.parse(output)),
    })
  }
}

function summarizeFilmSourceManifest(sourceManifest: StoryIndexProviderInput['sourceManifest']): Record<string, unknown> {
  return {
    duration: sourceManifest.duration,
    fps: sourceManifest.fps,
    height: sourceManifest.height,
    orientation: sourceManifest.orientation,
    sourcePath: sourceManifest.sourcePath,
    width: sourceManifest.width,
  }
}

function summarizeFilmRecapScriptInput(input: RecapScriptProviderInput): Record<string, unknown> {
  return {
    asrResult: input.asrResult,
    sourceManifest: summarizeFilmSourceManifest(input.sourceManifest),
    storyIndex: input.storyIndex,
    targetDurationSeconds: input.targetDurationSeconds,
    vlmAnalysis: input.vlmAnalysis,
  }
}
