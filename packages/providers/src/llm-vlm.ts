import type {LLMClient, LLMMessage} from '@video-agent/llm'

import {posix} from 'node:path'

import type {SceneFrameBatch, VLMProvider, VLMScene} from './contracts.js'

import {bunFile} from './bun-runtime.js'
import {createFileDataUri, resolveImageMimeType} from './llm-media-utils.js'
import {attachProviderMetadata} from './metadata.js'
import {VlmScenesSchema} from './schemas.js'

const MAX_VLM_IMAGE_PARTS = 16

export class LLMVLMProvider implements VLMProvider {
  constructor(private readonly llm: LLMClient) {}

  async analyzeScenes(input: SceneFrameBatch[], context?: string): Promise<VLMScene[]> {
    const result = await this.llm.generateObject({
      messages: await createVlmMessages(input, context),
      schema: VlmScenesSchema,
      temperature: 0.2,
    })

    return attachProviderMetadata(VlmScenesSchema.parse(result.object), {
      usage: result.usage,
    })
  }
}

async function createVlmMessages(input: SceneFrameBatch[], context?: string): Promise<LLMMessage[]> {
  const sampledFramePaths = sampleVlmFramePaths(input)
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
          'Use attached images and frame paths as evidence when they support the description.',
          'Use seconds for time ranges and do not invent scene ids.',
        ],
        sampledFrames: sampledFramePaths,
        sceneBatches: input,
      }),
      type: 'text' as const,
    },
    ...imageParts.filter((part): part is NonNullable<typeof part> => part !== undefined),
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

async function createVlmImagePart(path: string): Promise<{data: string; filename: string; mediaType: string; type: 'file'} | undefined> {
  try {
    const image = await bunFile(path).bytes()
    const mediaType = resolveImageMimeType(path)

    return {
      data: createFileDataUri(image, mediaType),
      filename: posix.basename(path),
      mediaType,
      type: 'file',
    }
  } catch {
    return undefined
  }
}
