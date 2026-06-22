import type {LLMClient, LLMMessage} from '@video-agent/llm'

import {readFile} from 'node:fs/promises'
import {posix} from 'node:path'

import type {SceneFrameBatch, VLMProvider, VLMScene} from '../contracts.js'

import {createProviderObjectPromptRequest} from '../prompt.js'
import {PROVIDER_PROMPT_VLM_SCENE_ANALYSIS_STAGE} from '../prompt-stages.js'
import {createFileDataUri, resolveImageMimeType} from './media-utils.js'
import {parseVlmScenes} from '../json-response.js'
import {attachProviderMetadata} from '../metadata.js'
import {SceneFrameBatchesSchema, VlmScenesSchema} from '../schemas.js'
import {validateVlmScenesForBatches} from '../vlm-validation.js'

const MAX_VLM_IMAGE_PARTS = 16

export class LLMVLMProvider implements VLMProvider {
  constructor(private readonly llm: LLMClient) {}

  async analyzeScenes(input: SceneFrameBatch[], context?: string): Promise<VLMScene[]> {
    const batches = SceneFrameBatchesSchema.parse(input)
    const messages = await createVlmMessages(batches, context)
    const result = await this.llm.generateObject(createProviderObjectPromptRequest({
      buildMessages: () => messages,
      id: 'llm.vlm.scene-analysis',
      promptInput: {
        context,
        sceneBatches: batches,
      },
      schema: VlmScenesSchema,
      schemaName: 'VlmScenes',
      stage: PROVIDER_PROMPT_VLM_SCENE_ANALYSIS_STAGE,
      temperature: 0.2,
    }))

    return attachProviderMetadata(validateVlmScenesForBatches(parseVlmScenes(result.object), batches), {
      usage: result.usage,
    })
  }
}

async function createVlmMessages(input: SceneFrameBatch[], context?: string): Promise<LLMMessage[]> {
  const sampledFramePaths = sampleVlmFramePaths(input)
  if (sampledFramePaths.length === 0) {
    throw new Error('LLM VLM analysis requires at least one sampled frame image; no path-only visual inference is allowed.')
  }

  const imageParts = await Promise.all(sampledFramePaths.map(async (path) => createVlmImagePart(path)))
  const content = [
    {
      text: JSON.stringify({
        context,
        goal: 'Create visual scene analysis JSON. Return only data matching the schema.',
        instructions: [
          'Return one scene entry for each input batch.',
          'Preserve sceneId values exactly.',
          'Fill actions, characters, emotions, plotClues, and relationships directly from the visible evidence and context.',
          'Use concise canonical phrases for structured fields; leave a field empty only when the evidence does not support it.',
          'Use attached images as the visual evidence. Frame paths are identifiers only; do not infer visual content from filenames or paths.',
          'Use seconds for time ranges and do not invent scene ids.',
        ],
        sampledFrames: sampledFramePaths,
        sceneBatches: input,
      }),
      type: 'text' as const,
    },
    ...imageParts,
  ]

  return [
    {
      content,
      role: 'user',
    },
  ] as LLMMessage[]
}

function sampleVlmFramePaths(input: SceneFrameBatch[]): string[] {
  const allFramePaths = Array.from(new Set(input.flatMap((batch) => batch.frames)))

  if (allFramePaths.length <= MAX_VLM_IMAGE_PARTS) {
    return allFramePaths
  }

  const representativePaths = sampleEvenly(
    input
      .map((batch) => batch.frames[0])
      .filter((path): path is string => path !== undefined),
    MAX_VLM_IMAGE_PARTS,
  )
  const selected = new Set(representativePaths)

  if (selected.size < MAX_VLM_IMAGE_PARTS) {
    for (const path of sampleEvenly(allFramePaths, MAX_VLM_IMAGE_PARTS)) {
      selected.add(path)

      if (selected.size >= MAX_VLM_IMAGE_PARTS) {
        break
      }
    }
  }

  return [...selected]
}

function sampleEvenly<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) {
    return values
  }

  if (limit === 1) {
    const first = values[0]

    return first === undefined ? [] : [first]
  }

  const lastIndex = values.length - 1

  return Array.from({length: limit}, (_, index) => values[Math.round((index * lastIndex) / (limit - 1))])
    .filter((value): value is T => value !== undefined)
}

async function createVlmImagePart(path: string): Promise<{data: string; filename: string; mediaType: string; type: 'file'}> {
  try {
    const image = await readFile(path)
    const mediaType = resolveImageMimeType(path)

    return {
      data: createFileDataUri(image, mediaType),
      filename: posix.basename(path),
      mediaType,
      type: 'file',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`LLM VLM analysis requires readable frame image "${path}"; no path-only visual inference is allowed: ${message}`)
  }
}
