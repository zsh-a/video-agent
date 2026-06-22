import type {QualitySummary} from './status-types.js'

import {QualityReportSchema} from '../artifacts/core-schemas.js'
import {readOptionalJson} from '../shared/file-io.js'

export async function readQualitySummary(path: string): Promise<QualitySummary> {
  const value = await readOptionalJson(path)

  if (value === undefined) {
    return createEmptyQualitySummary()
  }

  const report = QualityReportSchema.parse(value)

  return {
    errors: report.summary.errors,
    issues: report.issues.length,
    warnings: report.summary.warnings,
  }
}

function createEmptyQualitySummary(): QualitySummary {
  return {
    errors: 0,
    issues: 0,
    warnings: 0,
  }
}
