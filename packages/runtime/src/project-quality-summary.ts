import type {QualitySummary} from './project-status-types.js'

import {readOptionalJson} from './file-io.js'
import {isRecord, readNonnegativeNumber} from './project-status-utils.js'

export async function readQualitySummary(path: string): Promise<QualitySummary> {
  const report = await readOptionalJson<QualityReportLike>(path)

  if (report === undefined) {
    return createEmptyQualitySummary()
  }

  if (isQualitySummary(report.summary)) {
    return {
      errors: report.summary.errors,
      issues: Array.isArray(report.issues) ? report.issues.length : report.summary.errors + report.summary.warnings,
      warnings: report.summary.warnings,
    }
  }

  if (!Array.isArray(report.issues)) {
    return createEmptyQualitySummary()
  }

  return {
    errors: report.issues.filter((issue) => isQualityIssueLike(issue) && issue.severity === 'error').length,
    issues: report.issues.length,
    warnings: report.issues.filter((issue) => isQualityIssueLike(issue) && issue.severity === 'warning').length,
  }
}

function createEmptyQualitySummary(): QualitySummary {
  return {
    errors: 0,
    issues: 0,
    warnings: 0,
  }
}

function isQualitySummary(value: unknown): value is {errors: number; warnings: number} {
  return isRecord(value) && readNonnegativeNumber(value.errors) !== undefined && readNonnegativeNumber(value.warnings) !== undefined
}

function isQualityIssueLike(value: unknown): value is {severity: 'error' | 'warning'} {
  return isRecord(value) && (value.severity === 'error' || value.severity === 'warning')
}

interface QualityReportLike {
  issues?: unknown[]
  summary?: unknown
}
