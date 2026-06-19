import type {LLMUsage} from '../types.js'

export function normalizeUsage(usage: undefined | {inputTokens?: number; outputTokens?: number; totalTokens?: number}): LLMUsage | undefined {
  if (usage === undefined) {
    return undefined
  }

  return {
    ...(usage.inputTokens === undefined ? {} : {inputTokens: usage.inputTokens}),
    ...(usage.outputTokens === undefined ? {} : {outputTokens: usage.outputTokens}),
    ...(usage.totalTokens === undefined ? {} : {totalTokens: usage.totalTokens}),
  }
}
