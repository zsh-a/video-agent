import type {ProjectQualityReport} from '@video-agent/runtime'

import {formatQualityRenderSummary} from './quality-output.js'

export function createExportQualityFailurePayload(projectId: string, quality: ProjectQualityReport, message: string): {
  error: {
    code: 'export_quality_failed'
    message: string
    name: 'ExportQualityError'
  }
  ok: false
  projectId: string
  quality: ProjectQualityReport
} {
  return {
    error: {
      code: 'export_quality_failed',
      message,
      name: 'ExportQualityError',
    },
    ok: false,
    projectId,
    quality,
  }
}

export function formatExportQualityFailure(projectId: string, quality: ProjectQualityReport): string {
  return [
    `Export blocked: project ${projectId} did not pass quality checks.`,
    `Quality: ${quality.summary.errors} errors, ${quality.summary.warnings} warnings`,
    `Pipeline: ${quality.pipeline.errors} errors, ${quality.pipeline.warnings} warnings`,
    `Content: ${quality.content.errors} errors, ${quality.content.warnings} warnings`,
    `Render: ${formatQualityRenderSummary(quality.render)}`,
    `Artifacts: ${quality.artifacts.ok ? 'ok' : 'not ok'} (${quality.artifacts.summary.changed} changed, ${quality.artifacts.summary.missing} missing, ${quality.artifacts.summary.schemaInvalid} schema invalid, ${quality.artifacts.summary.untracked} untracked)`,
  ].join('\n')
}
