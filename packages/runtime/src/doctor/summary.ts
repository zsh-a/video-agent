import type {HealthCheck, RuntimeHealthSummary} from './types.js'

export function summarizeHealthChecks(checks: HealthCheck[]): RuntimeHealthSummary {
  return {
    fail: checks.filter((check) => check.status === 'fail').length,
    pass: checks.filter((check) => check.status === 'pass').length,
    total: checks.length,
    warn: checks.filter((check) => check.status === 'warn').length,
  }
}
