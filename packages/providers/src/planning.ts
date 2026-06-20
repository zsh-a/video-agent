import type {GenerateObjectRequest, LLMClient, LLMMessage} from '@video-agent/llm'

import {CharacterIndexEntrySchema, CharacterIndexSchema, NarrationSchema, NarrativeBeatSchema, NarrativeBeatsSchema, RecapScriptSchema, StoryIndexSchema, StoryboardSchema, type Narration, type RecapScript, type Storyboard} from '@video-agent/ir'
import {z} from 'zod'

import type {RecapScriptProviderInput, ScriptProvider, ScriptProviderInput, StoryIndexProviderInput, StoryIndexProviderOutput, StoryboardProvider, StoryboardProviderInput} from './contracts.js'

const PLANNING_LLM_VALIDATION_REWRITE_ATTEMPTS = 3

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
    return generateValidatedPlanningObject(this.llm, {
      messages: [
        {
          content: JSON.stringify({
            goal: 'Create concise video storyboard JSON. Return only data that matches the provided schema.',
            instructions: [
              'Create a StoryboardIR for a text-driven explainer video, similar to a slide-by-slide PPT walkthrough over the source footage.',
              'Return language explicitly from the requested/source language; do not rely on schema defaults.',
              'Return targetPlatform explicitly; use generic only when no specific platform is requested or evident.',
              'When longVideo.selectedMoments is present, create one storyboard scene for each selected moment unless two adjacent moments are duplicates.',
              'Every selected moment must be represented by at least one storyboard scene with the same sourceRange.',
              'Do not collapse all selected moments into one full-length scene.',
              'Use scene IDs from sceneAnalysis or transcript-derived order.',
              'Keep sourceRange within media duration when present.',
              'Keep each scene duration equal to its sourceRange length.',
              'Preserve selected moment sourceRange values and evidence refs such as chunks/000/vlm.json when useful.',
              'Every scene must include explicit evidence and visualStyle. Use an empty evidence array only when no source evidence exists.',
              'Use evidence refs transcript.json and scene-analysis.json only when selected moment evidence is unavailable.',
              'Use visualStyle "slide_explainer" for scenes that primarily explain text or app concepts.',
              'Write concise scene narration that explains the key point; do not paste the raw transcript wholesale.',
              'Return clean single-line narration and visualStyle text with no leading/trailing whitespace, repeated spaces, tabs, or newlines.',
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
    }, {
      contextLabel: 'Storyboard',
      repairGoal: 'Rewrite the storyboard JSON so it passes schema validation. Return a complete replacement object, not a patch.',
      repairInstructions: [
        'Use the validationError as binding feedback.',
        'Do not ask the runtime to infer language, targetPlatform, scene evidence, narration, visualStyle, source ranges, scene duration, or scene ordering.',
        'Keep the storyboard grounded in selected moments, transcript, scene analysis, and mediaInfo.',
        'Cover every selected moment sourceRange explicitly when longVideo.selectedMoments is provided.',
        'Return explicit scene timing, narration, visual style, and evidence for every scene.',
        'Rewrite text fields so they are clean single-line LLM output; do not rely on runtime trim or whitespace repair.',
      ],
      validate: (output) => validateGeneratedStoryboardOutput(input, output),
    })
  }
}

export class LLMScriptProvider implements ScriptProvider {
  constructor(private readonly llm: LLMClient) {}

  async createNarration(input: ScriptProviderInput) {
    return generateValidatedPlanningObject(this.llm, {
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
              'Return clean single-line narration text with no leading/trailing whitespace, repeated spaces, tabs, or newlines.',
            ],
            longVideo: summarizeLongVideoPlanning(input),
            storyboard: input.storyboard,
          }),
          role: 'user',
        },
      ],
      schema: NarrationSchema,
      temperature: 0.2,
    }, {
      contextLabel: 'Narration',
      repairGoal: 'Rewrite the narration JSON so it passes schema validation. Return a complete replacement object, not a patch.',
      repairInstructions: [
        'Use the validationError as binding feedback.',
        'Do not ask the runtime to infer sceneId links, segment timing, language, duration, start time, or narration text.',
        'Keep narration aligned to clipPlan clips and storyboard scenes.',
        'Cover every storyboard scene that has a clipPlan clip.',
        'Return explicit TTS-ready narration text, sceneId, start, and duration for every segment.',
        'Rewrite narration fields so they are clean single-line LLM output; do not rely on runtime trim or whitespace repair.',
      ],
      validate: (output) => validateGeneratedNarrationOutput(input, output),
    })
  }

  async createStoryIndex(input: StoryIndexProviderInput): Promise<StoryIndexProviderOutput> {
    return generateValidatedPlanningObject(this.llm, {
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
              'Every character must include aliases and evidence explicitly. Use an empty aliases array only when no alias is supported.',
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
    }, {
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

  async createRecapScript(input: RecapScriptProviderInput) {
    return generateValidatedPlanningObject(this.llm, {
      messages: [
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
            input: summarizeFilmRecapScriptInput(input),
          }),
          role: 'user',
        },
      ],
      schema: RecapScriptSchema,
      temperature: 0.35,
    }, {
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

const FilmStoryIndexLLMOutputSchema = z.object({
  beats: z.array(NarrativeBeatSchema).min(1),
  characters: z.array(CharacterIndexEntrySchema),
})

function validateGeneratedStoryboardOutput(input: StoryboardProviderInput, output: Storyboard): Storyboard {
  const storyboard = StoryboardSchema.parse(output)
  const mediaDuration = inferStoryboardMediaDuration(input.mediaInfo)
  const selectedMoments = input.longVideo?.selectedMoments?.moments ?? []

  requireCleanLLMPlanningText(storyboard.language, 'Storyboard LLM output language')

  if (storyboard.scenes.length === 0) {
    throw new Error('Storyboard LLM output must contain at least one scene; no empty storyboard fallback is allowed.')
  }

  for (const [index, scene] of storyboard.scenes.entries()) {
    requireCleanLLMPlanningText(scene.id, `Storyboard LLM output scene ${index + 1} id`)
    requireCleanLLMPlanningText(scene.visualStyle, `Storyboard LLM output scene ${index + 1} visualStyle`)
    validatePlanningEvidence(scene.evidence, `Storyboard LLM output scene ${index + 1} evidence`)

    if (scene.narration === undefined) {
      throw new Error(`Storyboard LLM output scene ${index + 1} must include explicit narration; no narration inference fallback is allowed.`)
    }

    requireCleanLLMPlanningText(scene.narration, `Storyboard LLM output scene ${index + 1} narration`)

    if (scene.sourceRange === undefined) {
      throw new Error(`Storyboard LLM output scene ${index + 1} must include explicit sourceRange; no positional sourceRange fallback is allowed.`)
    }

    if (mediaDuration > 0 && scene.sourceRange[1] > mediaDuration) {
      throw new Error(`Storyboard LLM output scene ${index + 1} sourceRange exceeds media duration; no runtime clipping fallback is allowed.`)
    }

    const sourceDuration = scene.sourceRange[1] - scene.sourceRange[0]

    if (Math.abs(scene.duration - sourceDuration) > 0.05) {
      throw new Error(`Storyboard LLM output scene ${index + 1} duration must match its sourceRange duration; no duration reconciliation fallback is allowed.`)
    }
  }

  for (const [index, moment] of selectedMoments.entries()) {
    const matchingScene = storyboard.scenes.find((scene) => scene.sourceRange !== undefined && timeRangesMatch(scene.sourceRange, moment.sourceRange))

    if (matchingScene === undefined) {
      throw new Error(`Storyboard LLM output must include a scene for selected moment ${index + 1} sourceRange; no selected-moment coverage fallback is allowed.`)
    }
  }

  return storyboard
}

function validateGeneratedNarrationOutput(input: ScriptProviderInput, output: Narration): Narration {
  const narration = NarrationSchema.parse(output)
  const storyboardSceneIds = new Set(input.storyboard.scenes.map((scene) => scene.id))
  const clipsBySceneId = new Map(input.clipPlan.clips.map((clip) => [clip.sceneId, clip]))
  const narratedSceneIds = new Set<string>()

  requireCleanLLMPlanningText(narration.language, 'Narration LLM output language')

  if (narration.segments.length === 0) {
    throw new Error('Narration LLM output must contain at least one segment; no empty narration fallback is allowed.')
  }

  for (const [index, segment] of narration.segments.entries()) {
    requireCleanLLMPlanningText(segment.id, `Narration LLM output segment ${index + 1} id`)
    requireCleanLLMPlanningText(segment.text, `Narration LLM output segment ${index + 1} text`)

    if (segment.voice !== undefined) {
      requireCleanLLMPlanningText(segment.voice, `Narration LLM output segment ${index + 1} voice`)
    }

    if (segment.sceneId === undefined) {
      throw new Error(`Narration LLM output segment ${index + 1} must include explicit sceneId; no scene-link fallback is allowed.`)
    }

    requireCleanLLMPlanningText(segment.sceneId, `Narration LLM output segment ${index + 1} sceneId`)

    if (!storyboardSceneIds.has(segment.sceneId)) {
      throw new Error(`Narration LLM output segment ${index + 1} references unknown storyboard sceneId "${segment.sceneId}".`)
    }

    if (segment.start === undefined) {
      throw new Error(`Narration LLM output segment ${index + 1} must include explicit start; no timeline fallback is allowed.`)
    }

    if (segment.duration === undefined) {
      throw new Error(`Narration LLM output segment ${index + 1} must include explicit duration; no duration fallback is allowed.`)
    }

    const clip = clipsBySceneId.get(segment.sceneId)

    if (clip === undefined) {
      throw new Error(`Narration LLM output segment ${index + 1} references sceneId "${segment.sceneId}" with no clipPlan clip.`)
    }

    if (segment.start < clip.start - 0.05 || segment.start + segment.duration > clip.start + clip.duration + 0.05) {
      throw new Error(`Narration LLM output segment ${index + 1} timing must stay within clipPlan clip "${clip.id}"; no timeline clipping fallback is allowed.`)
    }

    narratedSceneIds.add(segment.sceneId)
  }

  for (const scene of input.storyboard.scenes) {
    if (clipsBySceneId.has(scene.id) && !narratedSceneIds.has(scene.id)) {
      throw new Error(`Narration LLM output must include narration for storyboard scene "${scene.id}"; no storyboard-scene narration fallback is allowed.`)
    }
  }

  return narration
}

function validatePlanningEvidence(evidence: Storyboard['scenes'][number]['evidence'], field: string): void {
  for (const [index, item] of evidence.entries()) {
    requireCleanLLMPlanningText(item.ref, `${field}[${index}].ref`)

    if (item.text !== undefined) {
      requireCleanLLMPlanningText(item.text, `${field}[${index}].text`)
    }
  }
}

function requireCleanLLMPlanningText(value: string, field: string): void {
  if (value.trim() === '') {
    throw new Error(`${field} is empty; no runtime text fallback is allowed.`)
  }

  if (value !== value.trim()) {
    throw new Error(`${field} contains leading or trailing whitespace; no runtime text trim is allowed.`)
  }

  if (/[\r\n\t]/u.test(value)) {
    throw new Error(`${field} contains layout whitespace; no runtime whitespace repair is allowed.`)
  }

  if (/[^\S\r\n]{2,}/u.test(value)) {
    throw new Error(`${field} contains repeated whitespace; no runtime whitespace repair is allowed.`)
  }
}

function timeRangesMatch(left: [number, number], right: [number, number], tolerance = 0.05): boolean {
  return Math.abs(left[0] - right[0]) <= tolerance && Math.abs(left[1] - right[1]) <= tolerance
}

function inferStoryboardMediaDuration(mediaInfo: StoryboardProviderInput['mediaInfo']): number {
  if (mediaInfo.duration !== undefined) {
    return mediaInfo.duration
  }

  const durations = mediaInfo.streams
    .map((stream) => stream.duration)
    .filter((duration): duration is number => duration !== undefined)

  return durations.length === 0 ? 0 : Math.max(...durations)
}

function validateFilmStoryIndexLLMOutput(input: StoryIndexProviderInput, output: z.infer<typeof FilmStoryIndexLLMOutputSchema>): z.infer<typeof FilmStoryIndexLLMOutputSchema> {
  const seenBeatIds = new Set<string>()

  for (const [index, beat] of output.beats.entries()) {
    requireCleanLLMPlanningText(beat.id, `Film Recap story-index beat ${index + 1} id`)
    requireCleanLLMPlanningText(beat.summary, `Film Recap story-index beat ${index + 1} summary`)
    validatePlanningEvidence(beat.evidence, `Film Recap story-index beat ${index + 1} evidence`)

    if (seenBeatIds.has(beat.id)) {
      throw new Error(`Film Recap story-index beat ${index + 1} duplicates id "${beat.id}"; no runtime beat-id dedupe is allowed.`)
    }

    seenBeatIds.add(beat.id)

    if (beat.evidence.length === 0) {
      throw new Error(`Film Recap story-index beat ${beat.id} must include source evidence; no unsupported beat fallback is allowed.`)
    }

    if (!sourceRangeWithinDuration(beat.sourceRange, input.sourceManifest.duration)) {
      throw new Error(`Film Recap story-index beat ${beat.id} sourceRange must stay within sourceManifest.duration; no runtime sourceRange clipping fallback is allowed.`)
    }

    for (const [characterIndex, character] of beat.characters.entries()) {
      requireCleanLLMPlanningText(character, `Film Recap story-index beat ${beat.id} characters[${characterIndex}]`)
    }
  }

  const seenCharacterIds = new Set<string>()

  for (const [index, character] of output.characters.entries()) {
    requireCleanLLMPlanningText(character.id, `Film Recap story-index character ${index + 1} id`)
    requireCleanLLMPlanningText(character.name, `Film Recap story-index character ${index + 1} name`)
    validatePlanningEvidence(character.evidence, `Film Recap story-index character ${index + 1} evidence`)

    if (character.description !== undefined) {
      requireCleanLLMPlanningText(character.description, `Film Recap story-index character ${index + 1} description`)
    }

    if (seenCharacterIds.has(character.id)) {
      throw new Error(`Film Recap story-index character ${index + 1} duplicates id "${character.id}"; no runtime character-id dedupe is allowed.`)
    }

    seenCharacterIds.add(character.id)

    if (character.evidence.length === 0) {
      throw new Error(`Film Recap story-index character ${character.id} must include source evidence; no unsupported character fallback is allowed.`)
    }

    for (const [aliasIndex, alias] of character.aliases.entries()) {
      requireCleanLLMPlanningText(alias, `Film Recap story-index character ${character.id} aliases[${aliasIndex}]`)
    }
  }

  return output
}

function sourceRangeWithinDuration(sourceRange: [number, number], sourceDuration: number): boolean {
  const [start, end] = sourceRange

  return Number.isFinite(start)
    && Number.isFinite(end)
    && start >= 0
    && end <= sourceDuration
    && end > start
}

function validateRecapScriptLLMOutput(input: RecapScriptProviderInput, recapScript: RecapScript): RecapScript {
  const beatIds = new Set(input.storyIndex.beats.map((beat) => beat.id))
  const expectedDuration = input.targetDurationSeconds === undefined
    ? requireRecapScriptTotalDuration(recapScript, input.sourceManifest.duration)
    : requireRecapScriptTargetDuration(input.targetDurationSeconds, input.sourceManifest.duration)

  requireCleanLLMPlanningText(recapScript.language, 'Film Recap script language')
  requireCleanLLMPlanningText(recapScript.hook, 'Film Recap script hook')
  requireCleanLLMPlanningText(recapScript.outro, 'Film Recap script outro')

  if (recapScript.segments.length === 0) {
    throw new Error('Film Recap script LLM output must contain at least one segment; no empty script fallback is allowed.')
  }

  const seenSegmentIds = new Set<string>()
  let segmentDurationTotal = 0

  for (const [index, segment] of recapScript.segments.entries()) {
    requireCleanLLMPlanningText(segment.id, `Film Recap script segment ${index + 1} id`)
    requireCleanLLMPlanningText(segment.narrationText, `Film Recap script segment ${segment.id} narrationText`)
    requireCleanLLMPlanningText(segment.clipSelectionReason, `Film Recap script segment ${segment.id} clipSelectionReason`)
    requireCleanLLMPlanningText(segment.visualGuidance, `Film Recap script segment ${segment.id} visualGuidance`)

    if (seenSegmentIds.has(segment.id)) {
      throw new Error(`Film Recap script segment ${index + 1} duplicates id "${segment.id}"; no runtime segment-id dedupe is allowed.`)
    }

    seenSegmentIds.add(segment.id)

    if (segment.targetBeatIds.length !== 1) {
      throw new Error(`Film Recap script segment ${segment.id} must reference exactly one story-index beat; no runtime beat selection fallback is allowed.`)
    }

    const beatId = segment.targetBeatIds[0]

    if (beatId === undefined || !beatIds.has(beatId)) {
      throw new Error(`Film Recap script segment ${segment.id} references unknown story-index beat ${JSON.stringify(beatId)}; no runtime beat filtering fallback is allowed.`)
    }

    requireCleanLLMPlanningText(beatId, `Film Recap script segment ${segment.id} targetBeatIds[0]`)

    if (segment.pauseAfterMs > 2000) {
      throw new Error(`Film Recap script segment ${segment.id} pauseAfterMs must be 2000ms or less; rewrite LLM recap script output instead of clamping locally.`)
    }

    if (!sourceRangeWithinDuration(segment.sourceRange, input.sourceManifest.duration)) {
      throw new Error(`Film Recap script segment ${segment.id} sourceRange must stay within sourceManifest.duration; no runtime sourceRange clipping fallback is allowed.`)
    }

    const sourceRangeDuration = roundPlanningSeconds(segment.sourceRange[1] - segment.sourceRange[0])
    const suggestedDuration = roundPlanningSeconds(segment.suggestedDuration)

    if (suggestedDuration <= 0) {
      throw new Error(`Film Recap script segment ${segment.id} must have a positive suggestedDuration.`)
    }

    if (Math.abs(sourceRangeDuration - suggestedDuration) > 0.001) {
      throw new Error(`Film Recap script segment ${segment.id} suggestedDuration must match its LLM-authored sourceRange duration; no runtime clip truncation is allowed.`)
    }

    segmentDurationTotal = roundPlanningSeconds(segmentDurationTotal + suggestedDuration)
  }

  const scriptDuration = roundPlanningSeconds(recapScript.totalEstimatedDuration)

  if (Math.abs(scriptDuration - segmentDurationTotal) > 0.001) {
    throw new Error(`Film Recap script totalEstimatedDuration ${scriptDuration}s must match segment suggestedDuration sum ${segmentDurationTotal}s; no runtime duration scaling is allowed.`)
  }

  if (Math.abs(scriptDuration - expectedDuration) > 0.001) {
    throw new Error(`Film Recap script totalEstimatedDuration ${scriptDuration}s must match target duration ${expectedDuration}s; no runtime duration scaling is allowed.`)
  }

  return recapScript
}

function requireRecapScriptTotalDuration(recapScript: RecapScript, sourceDuration: number): number {
  const totalEstimatedDuration = roundPlanningSeconds(recapScript.totalEstimatedDuration)

  if (!Number.isFinite(totalEstimatedDuration) || totalEstimatedDuration <= 0) {
    throw new Error('Film Recap script LLM output must include a positive totalEstimatedDuration; no runtime duration fallback is allowed.')
  }

  if (sourceDuration > 0 && totalEstimatedDuration > sourceDuration) {
    throw new Error('Film Recap script totalEstimatedDuration must stay within sourceManifest.duration; no runtime duration clipping fallback is allowed.')
  }

  return totalEstimatedDuration
}

function requireRecapScriptTargetDuration(targetDurationSeconds: number, sourceDuration: number): number {
  const targetDuration = roundPlanningSeconds(targetDurationSeconds)

  if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
    throw new Error('Film Recap script targetDurationSeconds must be positive; no runtime target duration clipping fallback is allowed.')
  }

  if (sourceDuration > 0 && targetDuration > sourceDuration) {
    throw new Error('Film Recap script targetDurationSeconds must stay within sourceManifest.duration; no runtime target duration clipping fallback is allowed.')
  }

  return targetDuration
}

function roundPlanningSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

function createStoryIndexOutput(input: StoryIndexProviderInput, output: z.infer<typeof FilmStoryIndexLLMOutputSchema>): StoryIndexProviderOutput {
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

async function generateValidatedPlanningObject<T, Result>(
  llm: LLMClient,
  initialRequest: GenerateObjectRequest<T>,
  options: {
    contextLabel: string
    repairGoal: string
    repairInstructions: string[]
    validate: (output: T) => Result
  },
): Promise<Result> {
  return attemptValidatedPlanningObject(llm, initialRequest, options, {
    attempt: 0,
    lastError: undefined,
    rawObject: undefined,
    validationError: undefined,
  })
}

async function attemptValidatedPlanningObject<T, Result>(
  llm: LLMClient,
  initialRequest: GenerateObjectRequest<T>,
  options: {
    contextLabel: string
    repairGoal: string
    repairInstructions: string[]
    validate: (output: T) => Result
  },
  state: {
    attempt: number
    lastError: unknown
    rawObject: T | undefined
    validationError: string | undefined
  },
): Promise<Result> {
  if (state.attempt > PLANNING_LLM_VALIDATION_REWRITE_ATTEMPTS) {
    throw new Error(`${options.contextLabel} LLM rewrite failed after ${PLANNING_LLM_VALIDATION_REWRITE_ATTEMPTS} validation feedback attempt(s): ${state.validationError ?? 'unknown validation error'}.`, {
      cause: state.lastError,
    })
  }

  let object: T

  try {
    const result = await llm.generateObject(state.attempt === 0
      ? initialRequest
      : createPlanningValidationRewriteRequest(initialRequest, options, {
          attempt: state.attempt,
          attemptsRemaining: PLANNING_LLM_VALIDATION_REWRITE_ATTEMPTS - state.attempt,
          invalidObject: state.rawObject,
          validationError: state.validationError ?? 'The previous response did not pass validation.',
        }))

    object = result.object
  } catch (error) {
    return attemptValidatedPlanningObject(llm, initialRequest, options, {
      attempt: state.attempt + 1,
      lastError: error,
      rawObject: undefined,
      validationError: formatErrorMessage(error),
    })
  }

  try {
    return options.validate(object)
  } catch (error) {
    return attemptValidatedPlanningObject(llm, initialRequest, options, {
      attempt: state.attempt + 1,
      lastError: error,
      rawObject: object,
      validationError: formatErrorMessage(error),
    })
  }
}

function createPlanningValidationRewriteRequest<T>(
  initialRequest: GenerateObjectRequest<T>,
  options: {
    repairGoal: string
    repairInstructions: string[]
  },
  rewrite: {
    attempt: number
    attemptsRemaining: number
    invalidObject: T | undefined
    validationError: string
  },
): GenerateObjectRequest<T> {
  return {
    ...initialRequest,
    messages: createPlanningValidationRewriteMessages(initialRequest.messages ?? [], options, rewrite),
  }
}

function createPlanningValidationRewriteMessages<T>(
  initialMessages: LLMMessage[],
  options: {
    repairGoal: string
    repairInstructions: string[]
  },
  rewrite: {
    attempt: number
    attemptsRemaining: number
    invalidObject: T | undefined
    validationError: string
  },
): LLMMessage[] {
  return [
    ...initialMessages,
    {
      content: JSON.stringify({
        attempt: rewrite.attempt,
        invalidObject: rewrite.invalidObject,
        validationError: rewrite.validationError,
      }),
      role: 'assistant',
    },
    {
      content: JSON.stringify({
        attemptsRemaining: rewrite.attemptsRemaining,
        goal: options.repairGoal,
        instructions: [
          ...options.repairInstructions,
          'Return only data matching the schema.',
        ],
        validationError: rewrite.validationError,
      }),
      role: 'user',
    },
  ]
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
