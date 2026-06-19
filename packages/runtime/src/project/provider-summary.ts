import type {ProviderCallRecord, ProviderCallRole} from '../provider/calls.js'
import type {ProjectRuntimeSummary, ProviderRoleSummary} from './status-types.js'

export function summarizeProviderCalls(calls: ProviderCallRecord[]): ProjectRuntimeSummary['providers'] {
  const byRole: Record<ProviderCallRole, ProviderRoleSummary> = {
    asr: createEmptyProviderRoleSummary(),
    script: createEmptyProviderRoleSummary(),
    tts: createEmptyProviderRoleSummary(),
    vlm: createEmptyProviderRoleSummary(),
  }

  for (const call of calls) {
    byRole[call.role].total += 1

    if (call.cost !== undefined) {
      byRole[call.role].costs[call.cost.currency] = (byRole[call.role].costs[call.cost.currency] ?? 0) + call.cost.amount
    }

    if (call.status === 'failed') {
      byRole[call.role].failed += 1
    } else {
      byRole[call.role].succeeded += 1
    }
  }

  return {
    byRole,
    costs: sumProviderCosts(calls),
    failed: calls.filter((call) => call.status === 'failed').length,
    succeeded: calls.filter((call) => call.status === 'succeeded').length,
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
