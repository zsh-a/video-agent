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
    'The first non-whitespace character of the response must be "{" and the last non-whitespace character must be "}".',
    'The complete response must be directly parseable by JSON.parse without removing or rewriting any characters.',
    'Do not wrap the JSON in ```json, ```, XML tags, or any other delimiter.',
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

  return parseJsonCandidate(trimmed)
}

function isBadRequestApiError(error: unknown): boolean {
  return APICallError.isInstance(error) && error.statusCode === 400
}

function parseJsonCandidate(text: string): unknown {
  return JSON.parse(text) as unknown
}
