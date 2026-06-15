import type {z} from 'zod'

export type LLMMessageRole = 'assistant' | 'system' | 'user'

export interface LLMMessage {
  content: string
  role: LLMMessageRole
}

export interface GenerateTextRequest {
  messages?: LLMMessage[]
  prompt?: string
  temperature?: number
}

export interface GenerateTextResult {
  text: string
  usage?: LLMUsage
}

export interface GenerateObjectRequest<T> extends GenerateTextRequest {
  schema: z.ZodType<T>
}

export interface GenerateObjectResult<T> {
  object: T
  usage?: LLMUsage
}

export type StreamTextRequest = GenerateTextRequest

export type LLMEvent =
  | {
      text: string
      type: 'text'
      usage?: LLMUsage
    }
  | {
      text: string
      type: 'text-delta'
    }

export interface LLMUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface LLMClient {
  generateObject<T>(request: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>>
  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>
  streamText(request: StreamTextRequest): AsyncIterable<LLMEvent>
}
