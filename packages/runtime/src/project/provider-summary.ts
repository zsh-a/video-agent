import type {ProviderCallRecord, ProviderCallRole} from '../provider/call-record.js'

import {CALL_STATUS_FAILED, countCallResultStatuses} from '@video-agent/ir'
import {PROVIDER_CALL_ROLES} from '../provider/call-record.js'
import type {ProjectRuntimeSummary, ProviderRoleSummary} from './status-types.js'

export function summarizeProviderCalls(calls: ProviderCallRecord[]): ProjectRuntimeSummary['providers'] {
  const byRole = Object.fromEntries(PROVIDER_CALL_ROLES.map((role) => [role, createEmptyProviderRoleSummary()])) as Record<ProviderCallRole, ProviderRoleSummary>
  const callStatusCounts = countCallResultStatuses(calls)

  for (const call of calls) {
    byRole[call.role].total += 1

    if (call.cost !== undefined) {
      byRole[call.role].costs[call.cost.currency] = (byRole[call.role].costs[call.cost.currency] ?? 0) + call.cost.amount
    }

    if (call.status === CALL_STATUS_FAILED) {
      byRole[call.role].failed += 1
    } else {
      byRole[call.role].succeeded += 1
    }
  }

  return {
    byRole,
    costs: sumProviderCosts(calls),
    failed: callStatusCounts.failed,
    succeeded: callStatusCounts.succeeded,
    total: calls.length,
  }
}

function createEmptyProviderRoleSummary(): ProviderRoleSummary {
  return {
    costs: {},
    failed: 0,
    succeeded: 0,
    total: 0,
  }
}

function sumProviderCosts(calls: ProviderCallRecord[]): Record<string, number> {
  const costs: Record<string, number> = {}

  for (const call of calls) {
    if (call.cost !== undefined) {
      costs[call.cost.currency] = (costs[call.cost.currency] ?? 0) + call.cost.amount
    }
  }

  return costs
}
