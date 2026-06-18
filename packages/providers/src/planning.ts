import type {LLMClient} from '@video-agent/llm'

import {CharacterIndexEntrySchema, CharacterIndexSchema, NarrationSchema, NarrativeBeatSchema, NarrativeBeatsSchema, RecapScriptSchema, StoryIndexSchema, StoryboardSchema, type Narration, type RecapScript, type Storyboard} from '@video-agent/ir'
import {z} from 'zod'

import type {RecapScriptProviderInput, ScriptProvider, ScriptProviderInput, StoryIndexProviderInput, StoryIndexProviderOutput, StoryboardProvider, StoryboardProviderInput} from './contracts.js'

export class LLMRequiredStoryboardProvider implements StoryboardProvider {
  async createStoryboard(_input: StoryboardProviderInput): Promise<Storyboard> {
    throw new Error('Storyboard generation requires an LLM provider. Configure an llm block or pass an injected LLM client.')
  }
}

export class LLMRequiredScriptProvider implements ScriptProvider {
  async createNarration(_input: ScriptProviderInput): Promise<Narration> {
    throw new Error('Narration generation requires an LLM provider. Configure an llm block or pass an injected LLM client.')
  }

  async createRecapScript(_input: RecapScriptProviderInput): Promise<RecapScript> {
    throw new Error('Film Recap script writing requires an LLM provider. Configure an llm block or pass an injected LLM client.')
  }

  async createStoryIndex(_input: StoryIndexProviderInput): Promise<StoryIndexProviderOutput> {
    throw new Error('Film Recap story indexing requires an LLM provider. Configure an llm block or pass an injected LLM client.')
  }
}

export class LLMStoryboardProvider implements StoryboardProvider {
  constructor(private readonly llm: LLMClient) {}

  async createStoryboard(input: StoryboardProviderInput) {
    const result = await this.llm.generateObject({
      messages: [
        {
          content: JSON.stringify({
            goal: 'Create concise video storyboard JSON. Return only data that matches the provided schema.',
            instructions: [
              'Create a StoryboardIR for a text-driven explainer video, similar to a slide-by-slide PPT walkthrough over the source footage.',
              'When longVideo.selectedMoments is present, create one storyboard scene for each selected moment unless two adjacent moments are duplicates.',
              'Do not collapse all selected moments into one full-length scene.',
              'Use scene IDs from sceneAnalysis or transcript-derived order.',
              'Keep sourceRange within media duration when present.',
              'Keep each scene duration equal to its sourceRange length.',
              'Preserve selected moment sourceRange values and evidence refs such as chunks/000/vlm.json when useful.',
              'Use evidence refs transcript.json and scene-analysis.json only when selected moment evidence is unavailable.',
              'Use visualStyle "slide_explainer" for scenes that primarily explain text or app concepts.',
              'Write concise scene narration that explains the key point; do not paste the raw transcript wholesale.',
            ],
            longVideo: summarizeLongVideoPlanning(input),
            mediaInfo: summarizeMediaInfo(input.mediaInfo),
            sceneAnalysis: input.sceneAnalysis,
            transcript: input.transcript,
          }),
          role: 'user',
        },
      ],
      schema: StoryboardSchema,
      temperature: 0.2,
    })

    return StoryboardSchema.parse(result.object)
  }
}

export class LLMScriptProvider implements ScriptProvider {
  constructor(private readonly llm: LLMClient) {}

  async createNarration(input: ScriptProviderInput) {
    const result = await this.llm.generateObject({
      messages: [
        {
          content: JSON.stringify({
            clipPlan: input.clipPlan,
            goal: 'Create narration JSON for a video timeline. Return only data that matches the provided schema.',
            instructions: [
              'Create one narration segment per storyboard scene unless there is a strong reason to split.',
              'Preserve sceneId links.',
              'Keep segment start and duration aligned with clipPlan clips.',
              'When longVideo.selectedMoments is present, use the selected moment summaries and evidence as primary script context.',
              'Rewrite the source text into concise explainer narration, similar to speaker notes for PPT slides.',
              'Do not copy a long raw transcript wholesale into one narration segment.',
              'Keep each narration text focused on one key point and suitable for TTS.',
            ],
            longVideo: summarizeLongVideoPlanning(input),
            storyboard: input.storyboard,
          }),
          role: 'user',
        },
      ],
      schema: NarrationSchema,
      temperature: 0.2,
    })

    return NarrationSchema.parse(result.object)
  }

  async createStoryIndex(input: StoryIndexProviderInput): Promise<StoryIndexProviderOutput> {
    const result = await this.llm.generateObject({
      messages: [
        {
          content: JSON.stringify({
            asrResult: input.asrResult,
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
            ],
            language: input.language,
            sourceManifest: summarizeFilmSourceManifest(input.sourceManifest),
            timelineFusion: input.timelineFusion,
            vlmAnalysis: input.vlmAnalysis,
          }),
          role: 'user',
        },
      ],
      schema: FilmStoryIndexLLMOutputSchema,
      temperature: 0.25,
    })
    const output = FilmStoryIndexLLMOutputSchema.parse(result.object)

    return {
      characterIndex: CharacterIndexSchema.parse({
        characters: output.characters,
        source: input.sourceManifest.sourcePath,
        version: 1,
      }),
      narrativeBeats: NarrativeBeatsSchema.parse({
        beats: output.beats,
        source: input.sourceManifest.sourcePath,
        version: 1,
      }),
      storyIndex: StoryIndexSchema.parse({
        beats: output.beats,
        characters: output.characters,
        language: input.language,
        source: input.sourceManifest.sourcePath,
        sourceDuration: input.sourceManifest.duration,
        version: 1,
      }),
    }
  }

  async createRecapScript(input: RecapScriptProviderInput) {
    const result = await this.llm.generateObject({
      messages: [
        {
          content: JSON.stringify({
            goal: 'Write a Film Recap third-person narration script. Return only JSON matching RecapScriptSchema.',
            instructions: [
              'Create exactly one recap script segment for each storyIndex beat unless a beat is unusable; preserve chronological order.',
              'Every segment.targetBeatIds must contain the matching storyIndex beat id.',
              'Use ASR and VLM evidence to write scene-specific narration. Do not repeat generic phrases across segments.',
              'Do not paste raw dialogue wholesale. Rewrite into concise third-person recap commentary suitable for TTS.',
              'Make narrationText reflect the concrete event in that beat: who acts, what changes, and why it matters.',
              'Set sourceRange to the exact source clip range that should be used for the segment; this is the only semantic clip-selection signal downstream.',
              'Use visualGuidance to explain why that sourceRange visually supports the narration.',
              'For climax, reversal, or decision beats, include enough ASR/VLM detail to preserve the concrete plot event.',
              'Keep suggestedDuration proportional to beat sourceRange and make totalEstimatedDuration close to targetDurationSeconds.',
              'Do not invent character names or plot events not supported by storyIndex, asrResult, or vlmAnalysis.',
              'Use the storyIndex.language for hook, narrationText, visualGuidance, and outro.',
            ],
            input: summarizeFilmRecapScriptInput(input),
          }),
          role: 'user',
        },
      ],
      schema: RecapScriptSchema,
      temperature: 0.35,
    })

    return RecapScriptSchema.parse(result.object)
  }
}

const FilmStoryIndexLLMOutputSchema = z.object({
  beats: z.array(NarrativeBeatSchema).min(1),
  characters: z.array(CharacterIndexEntrySchema).default([]),
})

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

function summarizeMediaInfo(mediaInfo: StoryboardProviderInput['mediaInfo']): Record<string, unknown> {
  return {
    duration: mediaInfo.duration,
    formatName: mediaInfo.formatName,
    inputPath: mediaInfo.inputPath,
    streams: mediaInfo.streams.map((stream) => ({
      duration: stream.duration,
      fps: stream.fps,
      height: stream.height,
      type: stream.type,
      width: stream.width,
    })),
  }
}

function summarizeLongVideoPlanning(input: {longVideo?: StoryboardProviderInput['longVideo']}): Record<string, unknown> | undefined {
  if (input.longVideo === undefined) {
    return undefined
  }

  return {
    chapters: input.longVideo.chapters,
    chunkCount: input.longVideo.chunkPlan?.chunks.length,
    chunkSummaries: input.longVideo.chunkSummaries,
    globalOutline: input.longVideo.globalOutline,
    selectedMoments: input.longVideo.selectedMoments,
  }
}
