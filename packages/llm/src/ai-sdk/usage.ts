import type {LLMUsage} from '../types.js'

export function normalizeUsage(usage: undefined | {
  cachedInputTokens?: number
  inputTokenDetails?: {
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}): LLMUsage | undefined {
  if (usage === undefined) {
    return undefined
  }

  const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens
  const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens

  return {
    ...(cacheReadTokens === undefined ? {} : {cacheReadTokens}),
    ...(cacheWriteTokens === undefined ? {} : {cacheWriteTokens}),
    ...(usage.inputTokens === undefined ? {} : {inputTokens: usage.inputTokens}),
    ...(usage.outputTokens === undefined ? {} : {outputTokens: usage.outputTokens}),
    ...(usage.totalTokens === undefined ? {} : {totalTokens: usage.totalTokens}),
  }
}
