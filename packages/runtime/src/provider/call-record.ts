import type {ProviderCostMetadata, ProviderUsageMetadata} from '@video-agent/providers'
import type {CallResultStatus} from '@video-agent/ir'

import {CALL_RESULT_STATUSES, CALL_STATUS_FAILED, CALL_STATUS_SUCCEEDED} from '@video-agent/ir'

export const PROVIDER_CALL_ROLES = ['asr', 'script', 'tts', 'vlm'] as const
export const PROVIDER_CALL_STATUS_FAILED = CALL_STATUS_FAILED
export const PROVIDER_CALL_STATUS_SUCCEEDED = CALL_STATUS_SUCCEEDED
export const PROVIDER_CALL_STATUSES = CALL_RESULT_STATUSES

export type ProviderCallRole = (typeof PROVIDER_CALL_ROLES)[number]
export type ProviderCallStatus = CallResultStatus

export interface ProviderCallRecord {
  completedAt: string
  cost?: ProviderCostMetadata
  durationMs: number
  error?: {
    code?: string
    details?: Record<string, unknown>
    message: string
    name: string
    retryable?: boolean
    validationIssues?: {
      code: string
      message: string
      path: string[]
    }[]
  }
  input: Record<string, unknown>
  model?: string
  operation: string
  output?: Record<string, unknown>
  provider: string
  requestId: string
  role: ProviderCallRole
  startedAt: string
  status: ProviderCallStatus
  usage?: ProviderUsageMetadata
  version: 1
}

export interface ProviderCallStartRecord {
  input: Record<string, unknown>
  operation: string
  provider: string
  requestId: string
  role: ProviderCallRole
  startedAt: string
  status: 'started'
  version: 1
}

export interface ProviderCallRecorder {
  record(call: ProviderCallRecord): Promise<void>
  start?(call: ProviderCallStartRecord): Promise<void>
}
