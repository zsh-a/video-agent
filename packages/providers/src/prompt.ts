import type {GenerateObjectRequest, LLMMessage} from '@video-agent/llm'
import type {ProviderPromptStage} from './prompt-stages.js'

import {createObjectPromptRequest} from '@video-agent/llm'

const PROVIDER_PROMPT_VERSION = '2026-06-20'

export function createProviderObjectPromptRequest<TInput, TOutput>(input: {
  buildMessages: (promptInput: TInput) => LLMMessage[]
  id: string
  promptInput: TInput
  schema: GenerateObjectRequest<TOutput>['schema']
  schemaName: string
  stage: ProviderPromptStage
  temperature: number
}): GenerateObjectRequest<TOutput> {
  return createObjectPromptRequest({
    buildMessages: input.buildMessages,
    id: input.id,
    schema: input.schema,
    schemaName: input.schemaName,
    stage: input.stage,
    temperature: input.temperature,
    version: PROVIDER_PROMPT_VERSION,
  }, input.promptInput)
}
