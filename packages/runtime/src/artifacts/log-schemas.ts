import {z} from 'zod'

import {ArtifactRefSchema} from '@video-agent/ir'

export const PipelineEventLogLineSchema = z.object({
  artifact: ArtifactRefSchema.optional(),
  attempt: z.number().int().positive().optional(),
  current: z.number().nonnegative().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  level: z.enum(['debug', 'error', 'info', 'warn']).optional(),
  maxAttempts: z.number().int().positive().optional(),
  message: z.string().min(1).optional(),
  percent: z.number().nonnegative().optional(),
  projectId: z.string().min(1),
  retryDelayMs: z.number().nonnegative().optional(),
  stage: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
  time: z.string().min(1),
  total: z.number().nonnegative().optional(),
  type: z.enum(['artifact', 'log', 'stage:complete', 'stage:fail', 'stage:progress', 'stage:retry', 'stage:start']),
  unit: z.enum(['chunks', 'files', 'frames', 'scenes', 'seconds', 'segments', 'tokens']).optional(),
}).passthrough()

const ProviderCostMetadataSchema = z.object({
  amount: z.number(),
  currency: z.string().min(1),
  estimated: z.boolean().optional(),
}).passthrough()

const ProviderUsageMetadataSchema = z.object({
  audioSeconds: z.number().nonnegative().optional(),
  inputCharacters: z.number().nonnegative().optional(),
  inputTokens: z.number().nonnegative().optional(),
  outputCharacters: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
}).passthrough()

export const ProviderCallLogLineSchema = z.object({
  completedAt: z.string().min(1),
  cost: ProviderCostMetadataSchema.optional(),
  durationMs: z.number().nonnegative(),
  error: z.object({
    message: z.string().min(1),
    name: z.string().min(1),
  }).strict().optional(),
  input: z.record(z.string(), z.unknown()),
  model: z.string().min(1).optional(),
  operation: z.string().min(1),
  output: z.record(z.string(), z.unknown()).optional(),
  provider: z.string().min(1),
  requestId: z.string().min(1),
  role: z.enum(['asr', 'script', 'tts', 'vlm']),
  startedAt: z.string().min(1),
  status: z.enum(['failed', 'succeeded']),
  usage: ProviderUsageMetadataSchema.optional(),
  version: z.literal(1),
}).passthrough().superRefine((value, ctx) => {
  if (value.status === 'failed' && value.error === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Failed provider calls must include an error.',
      path: ['error'],
    })
  }
})

const LLMUsageSchema = z.object({
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  totalTokens: z.number().nonnegative().optional(),
}).passthrough()

export const LLMTraceLogLineSchema = z.object({
  completedAt: z.string().min(1),
  durationMs: z.number().nonnegative(),
  error: z.object({
    message: z.string().min(1),
    name: z.string().min(1),
  }).strict().optional(),
  model: z.string().min(1).optional(),
  operation: z.enum(['generateObject', 'generateObjectFallbackText', 'generateText', 'streamText']),
  provider: z.string().min(1).optional(),
  request: z.object({
    messages: z.array(z.unknown()).optional(),
    prompt: z.string().optional(),
    providerOptions: z.record(z.string(), z.unknown()).optional(),
    schema: z.unknown().optional(),
    temperature: z.number().optional(),
  }).passthrough(),
  requestId: z.string().min(1),
  response: z.object({
    object: z.unknown().optional(),
    text: z.string().optional(),
  }).passthrough().optional(),
  startedAt: z.string().min(1),
  status: z.enum(['failed', 'succeeded']),
  usage: LLMUsageSchema.optional(),
  version: z.literal(1),
}).passthrough().superRefine((value, ctx) => {
  if (value.status === 'failed' && value.error === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Failed LLM traces must include an error.',
      path: ['error'],
    })
  }
})
