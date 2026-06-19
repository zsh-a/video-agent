import {APICallError, NoObjectGeneratedError, RetryError} from 'ai'
import {toJSONSchema} from 'zod'

import type {GenerateObjectRequest, GenerateTextRequest} from '../types.js'

export function shouldFallbackToJsonText(error: unknown): boolean {
  return NoObjectGeneratedError.isInstance(error)
    || isBadRequestApiError(error)
    || (RetryError.isInstance(error) && isBadRequestApiError(error.lastError))
}

export function createJsonFallbackRequest<T>(request: GenerateObjectRequest<T>): GenerateTextRequest {
  const instruction = [
    'Return only valid JSON. Do not include markdown fences, prose, or commentary.',
    'The JSON must conform to this JSON Schema:',
    JSON.stringify(toJSONSchema(request.schema), null, 2),
  ].join('\n')

  if (request.messages !== undefined) {
    return {
      messages: [
        ...request.messages,
        {
          content: instruction,
          role: 'user',
        },
      ],
      ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
      ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
    }
  }

  if (request.prompt !== undefined) {
    return {
      prompt: `${request.prompt}\n\n${instruction}`,
      ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
      ...(request.temperature === undefined ? {} : {temperature: request.temperature}),
    }
  }

  throw new Error('LLM request requires either prompt or messages.')
}

export function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim()

  if (trimmed === '') {
    throw new Error('LLM returned empty text.')
  }

  try {
    return parseJsonCandidate(trimmed)
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)

    if (fenced?.[1] !== undefined) {
      return parseJsonCandidate(fenced[1])
    }

    return parseJsonCandidate(extractJsonSubstring(trimmed))
  }
}

function isBadRequestApiError(error: unknown): boolean {
  return APICallError.isInstance(error) && error.statusCode === 400
}

function parseJsonCandidate(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    const repaired = repairCommonLLMJson(text)

    if (repaired !== text) {
      return JSON.parse(repaired) as unknown
    }

    throw error
  }
}

function repairCommonLLMJson(text: string): string {
  return text.replace(
    /("comparison"\s*:\s*\{\s*"left"\s*:\s*\{[\s\S]*?\}\s*,)\s*\{\s*("label"\s*:)/g,
    '$1 "right": { $2',
  )
}

function extractJsonSubstring(text: string): string {
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const start = objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart)

  if (start === -1) {
    throw new Error('LLM text did not contain JSON.')
  }

  const objectEnd = text.lastIndexOf('}')
  const arrayEnd = text.lastIndexOf(']')
  const end = Math.max(objectEnd, arrayEnd)

  if (end < start) {
    throw new Error('LLM text contained incomplete JSON.')
  }

  return text.slice(start, end + 1)
}
