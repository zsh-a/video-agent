import {z} from 'zod'

export const CALL_STATUS_FAILED = 'failed' as const
export const CALL_STATUS_SUCCEEDED = 'succeeded' as const
export const CALL_RESULT_STATUSES = [CALL_STATUS_FAILED, CALL_STATUS_SUCCEEDED] as const

export type CallResultStatus = (typeof CALL_RESULT_STATUSES)[number]

export const CallResultStatusSchema = z.enum(CALL_RESULT_STATUSES)

export function countCallResultStatuses<T extends {status: CallResultStatus}>(items: readonly T[]): {
  failed: number
  succeeded: number
} {
  return {
    failed: items.filter((item) => item.status === CALL_STATUS_FAILED).length,
    succeeded: items.filter((item) => item.status === CALL_STATUS_SUCCEEDED).length,
  }
}
