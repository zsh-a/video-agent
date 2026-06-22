import type {QualityIssueSeverity} from '@video-agent/ir'

import {QUALITY_ERROR_SEVERITY, QUALITY_WARNING_SEVERITY} from '@video-agent/ir'

export {QUALITY_ERROR_SEVERITY, QUALITY_WARNING_SEVERITY}

export interface QualityIssueCounts {
  errors: number
  warnings: number
}

export interface QualityIssueSummary extends QualityIssueCounts {
  issues: number
}

export function countQualityIssues(issues: readonly {severity: QualityIssueSeverity}[]): QualityIssueCounts {
  return {
    errors: countQualityIssuesBySeverity(issues, QUALITY_ERROR_SEVERITY),
    warnings: countQualityIssuesBySeverity(issues, QUALITY_WARNING_SEVERITY),
  }
}

export function summarizeQualityIssues(issues: readonly {severity: QualityIssueSeverity}[]): QualityIssueSummary {
  return {
    ...countQualityIssues(issues),
    issues: issues.length,
  }
}

export function countQualityIssuesBySeverity(
  issues: readonly {severity: QualityIssueSeverity}[],
  severity: QualityIssueSeverity,
): number {
  return issues.filter((issue) => issue.severity === severity).length
}
