import type {QualitySummary} from './status-types.js'

import {QualityReportSchema} from '../artifacts/core-schemas.js'
import {readOptionalProjectJson} from './optional-json.js'

export async function readQualitySummary(path: string): Promise<QualitySummary> {
  const value = await readOptionalProjectJson(path)

  if (value === undefined) {
    return createEmptyQualitySummary()
  }

  const report = QualityReportSchema.safeParse(value)
  if (!report.success) {
    return createEmptyQualitySummary()
  }

  return {
    errors: report.data.summary.errors,
    issues: report.data.issues.length,
    warnings: report.data.summary.warnings,
  }
}

function createEmptyQualitySummary(): QualitySummary {
  return {
    errors: 0,
    issues: 0,
    warnings: 0,
  }
}
