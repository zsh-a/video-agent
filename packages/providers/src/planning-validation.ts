import type {GenerateObjectRequest, LLMClient, LLMMessage} from '@video-agent/llm'

import {CharacterIndexEntrySchema, CharacterIndexSchema, NarrativeBeatSchema, NarrativeBeatsSchema, StoryIndexSchema, type Evidence, type RecapScript} from '@video-agent/ir'
import {z} from 'zod'

import type {RecapScriptProviderInput, StoryIndexProviderInput, StoryIndexProviderOutput} from './contracts.js'

const PLANNING_LLM_VALIDATION_REWRITE_ATTEMPTS = 3

export const FilmStoryIndexLLMOutputSchema = z.object({
  beats: z.array(NarrativeBeatSchema).min(1),
  characters: z.array(CharacterIndexEntrySchema),
})

export function validateFilmStoryIndexLLMOutput(input: StoryIndexProviderInput, output: z.infer<typeof FilmStoryIndexLLMOutputSchema>): z.infer<typeof FilmStoryIndexLLMOutputSchema> {
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

export function validateRecapScriptLLMOutput(input: RecapScriptProviderInput, recapScript: RecapScript): RecapScript {
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

export function createStoryIndexOutput(input: StoryIndexProviderInput, output: z.infer<typeof FilmStoryIndexLLMOutputSchema>): StoryIndexProviderOutput {
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

export async function generateValidatedPlanningObject<T, Result>(
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

function validatePlanningEvidence(evidence: Evidence[], field: string): void {
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

function sourceRangeWithinDuration(sourceRange: [number, number], sourceDuration: number): boolean {
  const [start, end] = sourceRange

  return Number.isFinite(start)
    && Number.isFinite(end)
    && start >= 0
    && end <= sourceDuration
    && end > start
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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
