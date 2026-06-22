import {z} from 'zod'

import {PIPELINE_EVENT_TYPES, PROGRESS_UNITS} from '@video-agent/core'
import {ArtifactRefSchema, CALL_STATUS_FAILED} from '@video-agent/ir'
import {LLM_TRACE_OPERATIONS, LLM_TRACE_STATUSES} from '@video-agent/llm'
import {PROVIDER_CALL_ROLES, PROVIDER_CALL_STATUSES} from '../provider/call-record.js'

export const PipelineEventLogLineSchema = z.object({
  artifact: ArtifactRefSchema.optional(),
  agentRunId: z.string().min(1).optional(),
  agentStepId: z.string().min(1).optional(),
  attempt: z.number().int().positive().optional(),
  current: z.number().nonnegative().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number().nonnegative().optional(),
  level: z.enum(['debug', 'error', 'info', 'warn']).optional(),
  maxAttempts: z.number().int().positive().optional(),
  message: z.string().min(1).optional(),
  parentStepId: z.string().min(1).optional(),
  percent: z.number().nonnegative().optional(),
  projectId: z.string().min(1),
  retryDelayMs: z.number().nonnegative().optional(),
  stage: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
  time: z.string().min(1),
  toolCallId: z.string().min(1).optional(),
  total: z.number().nonnegative().optional(),
  type: z.enum(PIPELINE_EVENT_TYPES),
  unit: z.enum(PROGRESS_UNITS).optional(),
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
  totalTokens: z.number().nonnegative().optional(),
}).passthrough()

export const ProviderCallLogLineSchema = z.object({
  completedAt: z.string().min(1),
  cost: ProviderCostMetadataSchema.optional(),
  durationMs: z.number().nonnegative(),
  error: z.object({
    code: z.string().min(1).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    message: z.string().min(1),
    name: z.string().min(1),
    retryable: z.boolean().optional(),
    stack: z.string().min(1).optional(),
    validationIssues: z.array(z.object({
      code: z.string().min(1),
      message: z.string().min(1),
      path: z.array(z.string()),
    }).passthrough()).optional(),
  }).strict().optional(),
  input: z.record(z.string(), z.unknown()),
  model: z.string().min(1).optional(),
  operation: z.string().min(1),
  output: z.record(z.string(), z.unknown()).optional(),
  provider: z.string().min(1),
  requestId: z.string().min(1),
  role: z.enum(PROVIDER_CALL_ROLES),
  startedAt: z.string().min(1),
  status: z.enum(PROVIDER_CALL_STATUSES),
  usage: ProviderUsageMetadataSchema.optional(),
  version: z.literal(1),
}).passthrough().superRefine((value, ctx) => {
  if (value.status === CALL_STATUS_FAILED && value.error === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Failed provider calls must include an error.',
      path: ['error'],
    })
  }
})

const LLMUsageSchema = z.object({
  cacheReadTokens: z.number().nonnegative().optional(),
  cacheWriteTokens: z.number().nonnegative().optional(),
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  totalTokens: z.number().nonnegative().optional(),
}).passthrough()

const LLMPromptMetadataSchema = z.object({
  id: z.string().min(1),
  inputHash: z.string().min(1),
  schemaName: z.string().min(1).optional(),
  stage: z.string().min(1),
  version: z.string().min(1),
}).strict()

export const LLMTraceLogLineSchema = z.object({
  completedAt: z.string().min(1),
  durationMs: z.number().nonnegative(),
  error: z.object({
    details: z.record(z.string(), z.unknown()).optional(),
    message: z.string().min(1),
    name: z.string().min(1),
    retryable: z.boolean().optional(),
    stack: z.string().min(1).optional(),
  }).strict().optional(),
  model: z.string().min(1).optional(),
  operation: z.enum(LLM_TRACE_OPERATIONS),
  provider: z.string().min(1).optional(),
  request: z.object({
    cache: z.object({
      key: z.string().min(1),
      messageIndex: z.number().int().nonnegative().optional(),
      mode: z.literal('ephemeral'),
    }).strict().optional(),
    messages: z.array(z.unknown()).optional(),
    prompt: z.string().optional(),
    promptMetadata: LLMPromptMetadataSchema.optional(),
    providerOptions: z.record(z.string(), z.unknown()).optional(),
    schema: z.unknown().optional(),
    temperature: z.number().optional(),
  }).passthrough(),
  prompt: LLMPromptMetadataSchema.optional(),
  requestId: z.string().min(1),
  response: z.object({
    object: z.unknown().optional(),
    text: z.string().optional(),
  }).passthrough().optional(),
  startedAt: z.string().min(1),
  status: z.enum(LLM_TRACE_STATUSES),
  usage: LLMUsageSchema.optional(),
  version: z.literal(1),
}).passthrough().superRefine((value, ctx) => {
  if (value.status === CALL_STATUS_FAILED && value.error === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Failed LLM traces must include an error.',
      path: ['error'],
    })
  }
})
